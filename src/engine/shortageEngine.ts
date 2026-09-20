/**
 * Predictive Medicine Shortage Intelligence engine.
 *
 * Implements the mathematics in `docs/shortage-detection.md`:
 *
 *   D_t          exponentially weighted moving average of daily consumption
 *   DIR          days of inventory remaining
 *   LT_dynamic   contracted lead time inflated by observed slippage and vendor
 *                reliability
 *   Psi          triangulated non-stock risk signals
 *   SPS          shortage probability score (0 - 100)
 *
 * Every function here is pure. Nothing reads from or writes to global state, so
 * the same inputs always produce the same forecast and the control room can
 * re-run scenarios without touching the seeded database.
 */

import type {
  Medicine,
  RegionalAlert,
  RiskAssessment,
  RiskDriver,
  RiskTier,
  ScenarioInput,
  ScenarioProjection,
  ScenarioResult,
  TransferProposal,
  WardCoverage,
  WardId,
  WardStock,
} from "@/types";
// Relative rather than aliased: this module is shared by the browser bundle and
// the serverless API, and only the browser side resolves the `@/` alias.
import { WARD_LABELS } from "../types.js";

/* ------------------------------------------------------------------ */
/* Tunable model constants                                             */
/* ------------------------------------------------------------------ */

/** Smoothing factor for the EWMA burn rate, per the specification. */
export const EWMA_ALPHA = 0.35;

/** Days of history treated as "current" when deriving the surge baseline. */
export const RECENT_WINDOW_DAYS = 12;

/** Maximum Psi points each triangulated signal can contribute. */
export const SIGNAL_CAPS = {
  burn: 9,
  lead: 6,
  regional: 6,
  buffer: 10,
} as const;

/** Risk banding thresholds, per the intervention playbook. */
export const TIER_THRESHOLDS = {
  critical: 85,
  high: 60,
  moderate: 30,
} as const;

/** Days of cover below which a ward is flagged as under-provisioned. */
export const WARD_AT_RISK_DAYS = 3;

/** Sentinel used when daily burn is zero, so DIR stays finite and chartable. */
const NO_CONSUMPTION_DIR = 99;

/* ------------------------------------------------------------------ */
/* Small numeric helpers                                               */
/* ------------------------------------------------------------------ */

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function round(value: number, decimals = 1): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

export function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function stdDev(values: number[]): number {
  if (values.length < 2) return 0;
  const average = mean(values);
  const variance = values.reduce((sum, value) => sum + (value - average) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
}

/** Coefficient of variation: relative spread, used for lead-time volatility. */
export function coefficientOfVariation(values: number[]): number {
  const average = mean(values);
  if (average <= 0) return 0;
  return stdDev(values) / average;
}

export function formatDays(value: number): string {
  if (!Number.isFinite(value) || value >= NO_CONSUMPTION_DIR) return "99+";
  return value.toFixed(1);
}

/* ------------------------------------------------------------------ */
/* Core formulas                                                       */
/* ------------------------------------------------------------------ */

/** Full EWMA curve, oldest first. Used both for D_t and for drill-down charts. */
export function ewmaSeries(values: number[], alpha = EWMA_ALPHA): number[] {
  if (values.length === 0) return [];
  const series: number[] = [values[0]];
  for (let index = 1; index < values.length; index++) {
    const previous = series[index - 1];
    series.push(alpha * values[index] + (1 - alpha) * previous);
  }
  return series;
}

/** Latest EWMA value, i.e. D_t in the specification. */
export function ewma(values: number[], alpha = EWMA_ALPHA): number {
  const series = ewmaSeries(values, alpha);
  return series.length > 0 ? series[series.length - 1] : 0;
}

/**
 * Pre-surge consumption baseline: the mean of everything *before* the recent
 * window. Comparing the EWMA against this older level is what exposes an acute
 * demand surge, which a plain 30-day average would smear away.
 */
export function baselineBurnRate(values: number[], recentWindow = RECENT_WINDOW_DAYS): number {
  if (values.length === 0) return 0;
  const cut = Math.max(1, values.length - recentWindow);
  const older = values.slice(0, cut);
  return older.length > 0 ? mean(older) : mean(values);
}

/** DIR = (physical - allocated) / D_t, per the specification. */
export function daysOfInventoryRemaining(availableStock: number, dailyBurnRate: number): number {
  if (dailyBurnRate <= 0) return NO_CONSUMPTION_DIR;
  return clamp(availableStock / dailyBurnRate, 0, NO_CONSUMPTION_DIR);
}

/**
 * LT_dynamic = LT_contracted * (1 + sigma/mu) * R_vendor
 *
 * Both terms punish the same supplier behaviour the engine cares about: a
 * vendor that has historically delivered late, or delivered unpredictably.
 */
export function dynamicLeadTimeDays(
  contractedLeadTimeDays: number,
  leadTimeHistory: number[],
  reliabilityIndex: number,
): number {
  const variability = coefficientOfVariation(leadTimeHistory);
  const inflated = contractedLeadTimeDays * (1 + variability) * reliabilityIndex;
  return round(Math.max(inflated, contractedLeadTimeDays), 2);
}

/** Signed percentage by which observed deliveries overshoot the contract. */
export function leadTimeSlippagePct(contractedLeadTimeDays: number, leadTimeHistory: number[]): number {
  if (contractedLeadTimeDays <= 0 || leadTimeHistory.length === 0) return 0;
  const observed = mean(leadTimeHistory);
  return round(((observed - contractedLeadTimeDays) / contractedLeadTimeDays) * 100, 1);
}

/* ------------------------------------------------------------------ */
/* Triangulated signals (Psi)                                          */
/* ------------------------------------------------------------------ */

/** Stock physically on hand minus soft reservations and stranded ward stock. */
export function availableStock(medicine: Medicine): number {
  return Math.max(0, round(medicine.currentStock - medicine.allocatedStock - strandedStock(medicine), 2));
}

/**
 * Stock trapped above a ward's own par level. It is real inventory, but it
 * cannot serve a ward that is short without an inter-ward transfer, so it must
 * not be counted as cover. This is precisely the inefficiency the balancer
 * resolves.
 */
export function strandedStock(medicine: Medicine): number {
  return medicine.wardStock.reduce(
    (total, holding) => total + Math.max(0, holding.quantity - holding.parLevel),
    0,
  );
}

/**
 * Per-ward cover. Ward demand is apportioned by par level because the prototype
 * has no per-ward dispensing ledger to draw on.
 */
export function computeWardCoverage(medicine: Medicine, dailyBurnRate: number): WardCoverage[] {
  const totalPar = medicine.wardStock.reduce((sum, holding) => sum + holding.parLevel, 0) || 1;

  return medicine.wardStock.map((holding) => {
    const expectedDailyDemand = dailyBurnRate * (holding.parLevel / totalPar);
    const coverDays =
      expectedDailyDemand <= 0 ? NO_CONSUMPTION_DIR : round(holding.quantity / expectedDailyDemand, 1);
    return {
      ward: holding.ward,
      quantity: holding.quantity,
      parLevel: holding.parLevel,
      expectedDailyDemand: round(expectedDailyDemand, 2),
      coverDays,
      atRisk: coverDays < WARD_AT_RISK_DAYS,
    };
  });
}

/** Fraction of total par capacity currently unfilled, 0 - 1. */
export function wardDeficitRatio(medicine: Medicine): number {
  const totalPar = medicine.wardStock.reduce((sum, holding) => sum + holding.parLevel, 0);
  if (totalPar <= 0) return 0;
  const totalDeficit = medicine.wardStock.reduce(
    (sum, holding) => sum + Math.max(0, holding.parLevel - holding.quantity),
    0,
  );
  return clamp(totalDeficit / totalPar, 0, 1);
}

export interface TriangulatedSignals {
  psi: number;
  drivers: RiskDriver[];
}

/**
 * Combine the four independent risk signals into a single Psi score. Each leg
 * is capped so that no single signal can dominate the forecast on its own, and
 * each driver is returned with its evidence for the control room drill-down.
 */
export function triangulateSignals(input: {
  burnTrendPct: number;
  leadTimeSlippagePct: number;
  regionalAlert: RegionalAlert;
  availableStock: number;
  reorderThreshold: number;
  wardDeficitRatio: number;
}): TriangulatedSignals {
  // 1. Demand surge: how far current burn has risen above the pre-surge level.
  const burnPoints = clamp(Math.max(0, input.burnTrendPct) * 0.22, 0, SIGNAL_CAPS.burn);

  // 2. Lead-time slippage: observed deliveries overshooting the contract.
  const leadPoints = clamp(Math.max(0, input.leadTimeSlippagePct) * 0.14, 0, SIGNAL_CAPS.lead);

  // 3. Regional pressure: neighbouring facilities competing for the same stock.
  const regionalRaw = input.regionalAlert.pressureIndex * 0.4 + input.regionalAlert.neighbouringFacilities * 0.4;
  const regionalPoints = clamp(regionalRaw, 0, SIGNAL_CAPS.regional);

  // 4. Buffer depletion: shelf cover against the reorder threshold, plus the
  //    share of ward par capacity left unfilled.
  const thresholdPoints = clamp((1 - input.availableStock / Math.max(input.reorderThreshold, 1)) * 4, 0, 4);
  const wardPoints = clamp(input.wardDeficitRatio * 6, 0, 6);
  const bufferPoints = clamp(thresholdPoints + wardPoints, 0, SIGNAL_CAPS.buffer);

  const drivers: RiskDriver[] = [
    {
      code: "burn",
      label: "Consumption surge",
      detail:
        input.burnTrendPct > 0
          ? `Current EWMA burn is ${round(input.burnTrendPct, 1)}% above the pre-surge baseline.`
          : "Consumption is at or below its pre-surge baseline.",
      points: round(burnPoints, 1),
      maxPoints: SIGNAL_CAPS.burn,
    },
    {
      code: "lead",
      label: "Lead-time slippage",
      detail:
        input.leadTimeSlippagePct > 0
          ? `Observed deliveries run ${round(input.leadTimeSlippagePct, 1)}% longer than the contracted lead time.`
          : "Deliveries are arriving on or ahead of the contracted lead time.",
      points: round(leadPoints, 1),
      maxPoints: SIGNAL_CAPS.lead,
    },
    {
      code: "regional",
      label: "Regional pressure",
      detail:
        input.regionalAlert.pressureIndex > 0
          ? `${input.regionalAlert.neighbouringFacilities} neighbouring facilities report the same molecule as constrained (${input.regionalAlert.note}).`
          : "No regional constraint reported for this molecule.",
      points: round(regionalPoints, 1),
      maxPoints: SIGNAL_CAPS.regional,
    },
    {
      code: "buffer",
      label: "Buffer depletion",
      detail: `Shelf cover sits at ${round((input.availableStock / Math.max(input.reorderThreshold, 1)) * 100, 0)}% of the reorder threshold, with ${round(
        input.wardDeficitRatio * 100,
        0,
      )}% of ward par capacity unfilled.`,
      points: round(bufferPoints, 1),
      maxPoints: SIGNAL_CAPS.buffer,
    },
  ];

  const psi = clamp(
    drivers.reduce((sum, driver) => sum + driver.points, 0),
    0,
    SIGNAL_CAPS.burn + SIGNAL_CAPS.lead + SIGNAL_CAPS.regional + SIGNAL_CAPS.buffer,
  );

  return { psi: round(psi, 1), drivers };
}

/**
 * SPS = min(100, max(0, [1 - DIR / (LT_dynamic + SS_days)] * 100 + Psi))
 *
 * A product with more days of cover than it needs (including safety stock) is
 * clamped toward zero, so non-stock signals alone can never make an
 * over-stocked item look dangerous.
 */
export function shortageProbabilityScore(input: {
  dir: number;
  dynamicLeadTimeDays: number;
  safetyStockDays: number;
  psi: number;
}): number {
  const denominator = input.dynamicLeadTimeDays + input.safetyStockDays;
  if (denominator <= 0) return clamp(input.psi, 0, 100);
  const coverageRatio = input.dir / denominator;
  const raw = (1 - coverageRatio) * 100 + input.psi;
  return round(clamp(raw, 0, 100), 1);
}

export function riskTierFromScore(sps: number): RiskTier {
  if (sps >= TIER_THRESHOLDS.critical) return "critical";
  if (sps >= TIER_THRESHOLDS.high) return "high";
  if (sps >= TIER_THRESHOLDS.moderate) return "moderate";
  return "normal";
}

export const TIER_LABELS: Record<RiskTier, string> = {
  critical: "Critical",
  high: "High",
  moderate: "Moderate",
  normal: "Normal",
};

/* ------------------------------------------------------------------ */
/* Per-medicine assessment                                             */
/* ------------------------------------------------------------------ */

function addDays(from: Date, days: number): string {
  const result = new Date(from.getTime());
  result.setDate(result.getDate() + Math.round(days));
  return result.toISOString();
}

function buildRecommendation(
  tier: RiskTier,
  medicine: Medicine,
  dir: number,
  dynamicLeadTimeDays: number,
  reorderByDays: number,
  strandedUnits: number,
  alternatives: string[],
): string {
  const lead = `Dynamic lead time is ${dynamicLeadTimeDays.toFixed(1)} days for ${medicine.brandName}`;

  switch (tier) {
    case "critical": {
      const growth = Math.min(medicine.economicOrderQuantity, Math.max(medicine.reorderThreshold, 1));
      const alternativeText =
        alternatives.length > 0
          ? ` Present ${alternatives.slice(0, 2).join(" or ")} as a therapeutic equivalent in CPOE.`
          : "";
      const strandedText =
        strandedUnits > 0
          ? ` ${round(strandedUnits, 0)} units are stranded above ward par levels and can be redistributed immediately.`
          : "";
      return `${lead}. Raise an emergency purchase order of ${round(growth, 0)} units within ${Math.max(
        0,
        Math.round(reorderByDays),
      )} day(s).${strandedText}${alternativeText}`;
    }
    case "high":
      return `${lead}. Draft an automatic purchase order to the secondary vendor and restrict non-urgent outpatient dispensing until cover recovers above ${round(
        dir + 4,
        1,
      )} days.`;
    case "moderate":
      return `${lead}. Send a delivery status ping to the supplier and re-check cover in 48 hours.`;
    default:
      return `${lead}. No action beyond the standard scheduled replenishment cycle.`;
  }
}

export interface AssessOptions {
  /** Assessment clock; injectable so renders stay deterministic. */
  referenceDate?: Date;
  /** Display names of therapeutic equivalents, used inside recommendations. */
  alternativeNames?: string[];
}

/** Run the full forecast for one inventory item. */
export function assessMedicine(medicine: Medicine, options: AssessOptions = {}): RiskAssessment {
  const reference = options.referenceDate ?? new Date();
  const alternativeNames = options.alternativeNames ?? [];

  const burnSeries = ewmaSeries(medicine.consumptionHistory);
  const dailyBurnRate = round(burnSeries.length > 0 ? burnSeries[burnSeries.length - 1] : 0, 2);
  const baseline = round(baselineBurnRate(medicine.consumptionHistory), 2);
  const burnTrendPct = baseline > 0 ? round(((dailyBurnRate - baseline) / baseline) * 100, 1) : 0;

  const stranded = strandedStock(medicine);
  const available = availableStock(medicine);
  const dir = daysOfInventoryRemaining(available, dailyBurnRate);

  const dynamicLead = dynamicLeadTimeDays(
    medicine.supplier.contractedLeadTimeDays,
    medicine.supplier.leadTimeHistory,
    medicine.supplier.reliabilityIndex,
  );
  const slippage = leadTimeSlippagePct(
    medicine.supplier.contractedLeadTimeDays,
    medicine.supplier.leadTimeHistory,
  );

  const { psi, drivers } = triangulateSignals({
    burnTrendPct,
    leadTimeSlippagePct: slippage,
    regionalAlert: medicine.regionalAlert,
    availableStock: available,
    reorderThreshold: medicine.reorderThreshold,
    wardDeficitRatio: wardDeficitRatio(medicine),
  });

  const sps = shortageProbabilityScore({
    dir,
    dynamicLeadTimeDays: dynamicLead,
    safetyStockDays: medicine.safetyStockDays,
    psi,
  });

  const tier = riskTierFromScore(sps);

  // Order-by date: a purchase order must land before cover runs out, so it has
  // to be raised at least one dynamic lead time before the projected stockout.
  const reorderByDays = dir - dynamicLead;

  const coverage = computeWardCoverage(medicine, dailyBurnRate);

  return {
    medicineId: medicine.id,
    sku: medicine.sku,
    brandName: medicine.brandName,
    genericName: medicine.genericName,
    category: medicine.category,
    form: medicine.form,
    availableStock: available,
    dailyBurnRate,
    baselineBurnRate: baseline,
    burnTrendPct,
    dir: round(dir, 1),
    dynamicLeadTimeDays: dynamicLead,
    contractedLeadTimeDays: medicine.supplier.contractedLeadTimeDays,
    leadTimeSlippagePct: slippage,
    safetyStockDays: medicine.safetyStockDays,
    psi,
    sps,
    tier,
    projectedStockoutDate: addDays(reference, dir >= NO_CONSUMPTION_DIR ? 365 : dir),
    reorderByDate: addDays(reference, clamp(reorderByDays, -30, 365)),
    drivers,
    recommendation: buildRecommendation(
      tier,
      medicine,
      dir,
      dynamicLead,
      reorderByDays,
      stranded,
      alternativeNames,
    ),
    burnSeries: burnSeries.map((value) => round(value, 2)),
    wardsAtRisk: coverage.filter((ward) => ward.atRisk).length,
    worstWard:
      coverage.length > 0
        ? coverage.reduce((worst, ward) => (ward.coverDays < worst.coverDays ? ward : worst)).ward
        : null,
    strandedUnits: round(stranded, 0),
    coverageByWard: coverage,
  };
}

/** Assess the whole formulary, highest risk first. */
export function assessInventory(medicines: Medicine[], options: AssessOptions = {}): RiskAssessment[] {
  const byId = new Map(medicines.map((medicine) => [medicine.id, medicine]));

  return medicines
    .map((medicine) => {
      const alternativeNames = medicine.therapeuticAlternatives
        .map((id) => byId.get(id)?.brandName)
        .filter((name): name is string => Boolean(name));
      return assessMedicine(medicine, { ...options, alternativeNames });
    })
    .sort((a, b) => b.sps - a.sps);
}

/* ------------------------------------------------------------------ */
/* Intervention playbook                                                */
/* ------------------------------------------------------------------ */

export interface PortfolioSummary {
  total: number;
  critical: number;
  high: number;
  moderate: number;
  normal: number;
  /** Mean SPS across the formulary, 0 - 100. */
  meanScore: number;
  /** Highest single score, used for the control room gauge. */
  peakScore: number;
  wardsAtRisk: number;
  /** Value of inventory sitting in the critical and high bands, in INR. */
  valueAtRisk: number;
}

export function summarisePortfolio(assessments: RiskAssessment[], medicines: Medicine[]): PortfolioSummary {
  const priceById = new Map(medicines.map((medicine) => [medicine.id, medicine.unitPrice]));
  const count = (tier: RiskTier) => assessments.filter((item) => item.tier === tier).length;

  return {
    total: assessments.length,
    critical: count("critical"),
    high: count("high"),
    moderate: count("moderate"),
    normal: count("normal"),
    meanScore: assessments.length
      ? round(assessments.reduce((sum, item) => sum + item.sps, 0) / assessments.length, 1)
      : 0,
    peakScore: assessments.length ? Math.max(...assessments.map((item) => item.sps)) : 0,
    wardsAtRisk: assessments.reduce((sum, item) => sum + item.wardsAtRisk, 0),
    valueAtRisk: round(
      assessments
        .filter((item) => item.tier === "critical" || item.tier === "high")
        .reduce((sum, item) => sum + item.availableStock * (priceById.get(item.medicineId) ?? 0), 0),
      2,
    ),
  };
}

/**
 * Propose inter-ward redistributions.
 *
 * A proposal is only produced when a ward genuinely holds stock above its own
 * par level, because moving stranded stock into a short ward is the only
 * redistribution that lowers facility risk.
 *
 * A move is also dropped when it changes nothing: once the facility score is
 * pinned at the ceiling by a genuine facility-wide shortfall, shuffling stock
 * between wards cannot improve it, and offering a "-0 point" action would be
 * misleading. Such a case is reported through the purchase-order playbook
 * instead.
 */
export function buildTransferProposals(
  medicines: Medicine[],
  assessments: RiskAssessment[],
  decidedIds: Set<string> = new Set(),
  reference: Date = new Date(),
): TransferProposal[] {
  const byId = new Map(medicines.map((medicine) => [medicine.id, medicine]));
  const proposals: TransferProposal[] = [];

  for (const assessment of assessments) {
    if (assessment.tier !== "critical" && assessment.tier !== "high") continue;

    const medicine = byId.get(assessment.medicineId);
    if (!medicine) continue;

    const sources = medicine.wardStock.filter((holding) => holding.quantity > holding.parLevel);
    if (sources.length === 0) continue;

    const deficits = medicine.wardStock
      .filter((holding) => holding.quantity < holding.parLevel)
      .sort((a, b) => a.quantity / Math.max(a.parLevel, 1) - b.quantity / Math.max(b.parLevel, 1));
    if (deficits.length === 0) continue;

    // Largest surplus first, deepest deficit first.
    const source = sources.reduce((best, holding) =>
      holding.quantity - holding.parLevel > best.quantity - best.parLevel ? holding : best,
    );
    let remaining = source.quantity - source.parLevel;
    if (remaining <= 0) continue;

    for (const deficit of deficits) {
      if (remaining <= 0) break;
      const need = deficit.parLevel - deficit.quantity;
      const quantity = Math.min(need, remaining);
      if (quantity <= 0) continue;
      remaining -= quantity;

      const id = `xfer-${medicine.id}-${source.ward}-${deficit.ward}`;
      if (decidedIds.has(id)) continue;

      const projected = assessMedicine(applyWardTransfer(medicine, source.ward, deficit.ward, quantity), {
        referenceDate: reference,
      });

      const spsDrop = round(Math.max(0, assessment.sps - projected.sps), 1);
      const wardsRecovered = Math.max(0, assessment.wardsAtRisk - projected.wardsAtRisk);
      if (spsDrop < 0.1 && wardsRecovered === 0) continue;

      proposals.push({
        id,
        medicineId: medicine.id,
        drugName: medicine.brandName,
        fromWard: source.ward,
        toWard: deficit.ward,
        quantity: round(quantity, 0),
        surplusAtSource: round(source.quantity - source.parLevel, 0),
        deficitAtTarget: round(need, 0),
        rationale:
          `${WARD_LABELS[deficit.ward]} holds ${deficit.quantity} of ${deficit.parLevel} par (${round(
            (deficit.quantity / Math.max(deficit.parLevel, 1)) * 100,
            0,
          )}% covered) while ${WARD_LABELS[source.ward]} sits ${round(
            source.quantity - source.parLevel,
            0,
          )} units above par.`,
        estimatedSpsDrop: spsDrop,
        wardsRecovered,
        status: "proposed",
      });
    }
  }

  // Biggest risk reduction first, so the top action is the one that matters.
  return proposals.sort(
    (a, b) => b.estimatedSpsDrop - a.estimatedSpsDrop || b.wardsRecovered - a.wardsRecovered,
  );
}

/** Move units between two wards, leaving total facility stock untouched. */
export function applyWardTransfer(
  medicine: Medicine,
  fromWard: WardId,
  toWard: WardId,
  quantity: number,
): Medicine {
  if (quantity <= 0 || fromWard === toWard) return medicine;

  const wardStock: WardStock[] = medicine.wardStock.map((holding) => {
    if (holding.ward === fromWard) return { ...holding, quantity: Math.max(0, holding.quantity - quantity) };
    if (holding.ward === toWard) return { ...holding, quantity: holding.quantity + quantity };
    return { ...holding };
  });

  return { ...medicine, wardStock };
}

/**
 * Apply a dispensing event to a medicine: physical stock and the reservation
 * both fall. Used when a prescription is written or a dose is administered, so
 * the shortage forecast reacts to clinical activity immediately.
 */
export function dispenseStock(medicine: Medicine, units: number): Medicine {
  const dispensed = Math.max(0, round(units, 2));
  return {
    ...medicine,
    currentStock: Math.max(0, round(medicine.currentStock - dispensed, 2)),
    allocatedStock: Math.max(0, round(medicine.allocatedStock - Math.min(dispensed, medicine.allocatedStock), 2)),
  };
}

/** Reserve stock against a pending prescription without dispensing it yet. */
export function reserveStock(medicine: Medicine, units: number): Medicine {
  const reserved = Math.max(0, round(units, 2));
  return {
    ...medicine,
    allocatedStock: Math.min(medicine.currentStock, round(medicine.allocatedStock + reserved, 2)),
  };
}

/** In-stock therapeutic equivalents for a short or out-of-stock molecule. */
export function therapeuticAlternatives(
  medicine: Medicine,
  medicines: Medicine[],
  assessments: RiskAssessment[],
): { medicine: Medicine; assessment: RiskAssessment }[] {
  const byId = new Map(medicines.map((item) => [item.id, item]));
  const assessmentById = new Map(assessments.map((item) => [item.medicineId, item]));

  return medicine.therapeuticAlternatives
    .map((id) => {
      const candidate = byId.get(id);
      const assessment = assessmentById.get(id);
      return candidate && assessment ? { medicine: candidate, assessment } : null;
    })
    .filter((entry): entry is { medicine: Medicine; assessment: RiskAssessment } => entry !== null)
    .sort((a, b) => a.assessment.sps - b.assessment.sps);
}

/* ------------------------------------------------------------------ */
/* Scenario sandbox                                                    */
/* ------------------------------------------------------------------ */

/**
 * Re-run the whole forecast under a hypothetical disruption. The sandbox never
 * mutates live inventory; it clones the formulary, applies the shocks, and
 * reports the delta so planners can see which molecules escalate.
 */
export function simulateScenario(
  medicines: Medicine[],
  baseline: RiskAssessment[],
  input: ScenarioInput,
  reference: Date = new Date(),
): ScenarioResult {
  const baselineById = new Map(baseline.map((item) => [item.medicineId, item]));

  const shocked = medicines.map((medicine) => {
    const writeOff = clamp(input.stockWriteOffPct, 0, 90) / 100;
    const surge = 1 + clamp(input.demandSurgePct, -50, 300) / 100;

    const forcedConsumption = medicine.consumptionHistory.map((value) =>
      Math.max(0, Math.round(value * surge)),
    );

    return {
      ...medicine,
      currentStock: round(medicine.currentStock * (1 - writeOff), 2),
      consumptionHistory: forcedConsumption,
      regionalAlert: {
        ...medicine.regionalAlert,
        pressureIndex: clamp(medicine.regionalAlert.pressureIndex + input.regionalPressureDelta, 0, 15),
        note:
          input.regionalPressureDelta > 0
            ? `${medicine.regionalAlert.note} (sandbox: +${input.regionalPressureDelta} pressure)`
            : medicine.regionalAlert.note,
      },
      supplier: {
        ...medicine.supplier,
        leadTimeHistory: medicine.supplier.leadTimeHistory.map((days) =>
          round(days + clamp(input.leadTimeSlippageDays, 0, 30), 2),
        ),
      },
    };
  });

  const projected = assessInventory(shocked, { referenceDate: reference });

  const projections: ScenarioProjection[] = projected
    .map((item) => {
      const original = baselineById.get(item.medicineId);
      return {
        medicineId: item.medicineId,
        drugName: item.brandName,
        baselineSps: original?.sps ?? 0,
        projectedSps: item.sps,
        baselineDir: original?.dir ?? 0,
        projectedDir: item.dir,
        baselineTier: original?.tier ?? "normal",
        projectedTier: item.tier,
        escalated: (original?.tier ?? "normal") !== item.tier,
      };
    })
    .sort((a, b) => b.projectedSps - a.projectedSps);

  const criticalCount = projections.filter((item) => item.projectedTier === "critical").length;
  const highCount = projections.filter((item) => item.projectedTier === "high").length;
  const escalated = projections.filter((item) => item.escalated).length;

  const headline =
    escalated === 0
      ? `No medicines escalate under "${input.label}". Formulary remains stable at ${criticalCount} critical and ${highCount} high-risk medicines.`
      : `"${input.label}" causes ${escalated} medicine${escalated === 1 ? "" : "s"} to escalate into high-risk shortage levels, resulting in ${criticalCount} critical and ${highCount} high-risk medicines.`;

  return { input, projections, criticalCount, highCount, headline };
}

/* ------------------------------------------------------------------ */
/* Alert generation                                                    */
/* ------------------------------------------------------------------ */

/** Produce the alert payload for a locally reassessed medicine. */
export function buildAlertPayload(assessment: RiskAssessment): {
  message: string;
  severity: RiskTier;
} {
  const severity = assessment.tier;
  const message =
    severity === "critical"
      ? `${assessment.brandName} cover has fallen to ${formatDays(assessment.dir)} days against a ${assessment.dynamicLeadTimeDays.toFixed(
          1,
        )}-day lead time.`
      : severity === "high"
        ? `${assessment.brandName} is trending toward a stockout with ${formatDays(assessment.dir)} days of cover.`
        : `${assessment.brandName} is now in the ${severity} band (score ${assessment.sps}).`;

  return { message, severity };
}
