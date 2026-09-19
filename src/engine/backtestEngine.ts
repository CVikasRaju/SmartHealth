/**
 * Forecast backtesting.
 *
 * A predictive score is only worth trusting if somebody has measured it, so this
 * module replays a year of simulated ward activity through the real
 * `assessMedicine` function and asks a specific question of each day:
 *
 *   *if we had acted on today's score, would we have had warning?*
 *
 * It answers that against the rule most hospitals actually run — a reorder
 * threshold, with no forecast at all — using the *same* demand, the *same*
 * delivery behaviour and the *same* ordering policy for both methods, so the
 * only difference between the columns is the scoring.
 *
 * Honest limits, stated once and repeated on the page that renders this:
 *
 *   * the history is synthetic, generated from the seeded consumption profiles,
 *     because the prototype has no year of production dispensing data. The
 *     harness is the deliverable; point it at `consumption_history` from a real
 *     deployment and the numbers become real;
 *   * an event is a day on which demand went unserved. It is a stockout in the
 *     pharmacy sense, not necessarily a patient harmed;
 *   * the model is allowed to see signals a threshold rule cannot — observed
 *     lead-time slippage, regional pressure — which is precisely the claim being
 *     tested, not a thumb on the scale.
 */

import type { Medicine, RiskTier } from "../types";
import type { ConsumptionProfile } from "../data/mockData";
import { buildConsumption, createRandom } from "../data/mockData";
import { assessMedicine, riskTierFromScore } from "./shortageEngine";

const DAY_MS = 86_400_000;

export interface BacktestOptions {
  /** Length of the replay window in days. */
  days: number;
  /**
   * Days discarded before scoring begins, so the EWMA and the trend baseline
   * have history to work from rather than starting cold.
   */
  warmupDays: number;
  /** How far ahead a warning is allowed to count as advance notice. */
  horizonDays: number;
  /** Seed for delivery jitter, so a replay is reproducible. */
  seed: number;
  /** Risk bands that constitute an actionable warning. */
  flagTiers: RiskTier[];
  /**
   * Multi-week demand waves per molecule per year.
   *
   * A purchasing rule that only watches the shelf is tested by exactly the
   * event this score exists to anticipate, so the replay contains demand waves
   * rather than a flat year. They are seeded per molecule, so they are
   * reproducible and staggered across the formulary rather than simultaneous.
   */
  demandWaves: number;
}

export const DEFAULT_BACKTEST_OPTIONS: BacktestOptions = {
  days: 365,
  warmupDays: 60,
  horizonDays: 14,
  seed: 20_260_919,
  flagTiers: ["high", "critical"],
  demandWaves: 2,
};

export interface BacktestEvent {
  medicineId: string;
  brandName: string;
  /** Day index within the replay window. */
  day: number;
  date: string;
  unitsShort: number;
}

export interface WarningEpisode {
  start: number;
  end: number;
  /** The event this episode preceded, when it preceded one. */
  hitEventDay: number | null;
  /** Days of advance notice, measured from the first flagged day. */
  earlyByDays: number | null;
  /** Absolute error of the projected stockout date on the first flagged day. */
  dateErrorDays: number | null;
  peakSps: number;
}

export interface MethodScore {
  label: string;
  description: string;
  events: number;
  /** Events with at least one warning episode inside the horizon. */
  caught: number;
  missed: number;
  recall: number;
  /** Warning episodes, i.e. distinct occasions the method raised a flag. */
  warnings: number;
  hits: number;
  /** Warnings that preceded no event inside the horizon. */
  falseAlarms: number;
  precision: number;
  falseAlarmsPerMonth: number;
  medianDaysEarly: number;
  /**
   * Absolute error of the projected stockout date, or null when the method
   * cannot name a date at all. A threshold rule has no such estimate, and
   * crediting it with one would flatter it.
   */
  medianDateErrorDays: number | null;
}

export interface MoleculeBacktest {
  medicineId: string;
  brandName: string;
  sku: string;
  events: number;
  method: MethodScore;
  baseline: MethodScore;
  /** Mean daily demand over the scoring window. */
  meanDailyDemand: number;
  /** Days of cover the shelf actually held, and what the score claimed. */
  observedMinCoverDays: number;
  /** Every scored day, so the failure can be inspected rather than assumed. */
  timeline: TimelinePoint[];
}

export interface BacktestResult {
  window: { start: string; end: string; days: number; scoredDays: number };
  options: BacktestOptions;
  method: MethodScore;
  baseline: MethodScore;
  molecules: MoleculeBacktest[];
  events: BacktestEvent[];
  /** Recall and precision as the advance-notice window widens. */
  horizonCurve: { horizonDays: number; methodRecall: number; baselineRecall: number; methodPrecision: number; baselinePrecision: number }[];
}

/* ------------------------------------------------------------------ */
/* Simulation                                                          */
/* ------------------------------------------------------------------ */

interface DayObservation {
  day: number;
  onHand: number;
  flagged: boolean;
  baselineFlagged: boolean;
  sps: number;
  /** Days of inventory remaining as the score saw it that morning. */
  dir: number;
  predictedStockoutDay: number | null;
}

/** One scored day, for the timeline chart on the results page. */
export interface TimelinePoint {
  day: number;
  date: string;
  onHand: number;
  coverDays: number;
  sps: number;
  flagged: boolean;
  baselineFlagged: boolean;
  stockout: boolean;
}

interface SimulatedEvent {
  start: number;
  end: number;
  unitsShort: number;
}

/** Deterministic per-molecule seed offset, so molecules do not share a stream. */
function seedFor(base: number, key: string): number {
  let hash = 0;
  for (let index = 0; index < key.length; index++) {
    hash = (Math.imul(hash, 31) + key.charCodeAt(index)) | 0;
  }
  return (base ^ (hash >>> 0)) >>> 0;
}

/**
 * Overlay reproducible demand waves onto the base consumption series.
 *
 * An infection wave, a seasonal surge or a new clinic all look the same to the
 * shelf: demand climbs for a few weeks and then settles. Waves are drawn from
 * the molecule's own stream so the same seed always produces the same year.
 */
function applyDemandWaves(demand: number[], waves: number, random: () => number): number[] {
  const shaped = [...demand];
  if (waves <= 0 || shaped.length < 60) return shaped;

  for (let index = 0; index < waves; index++) {
    const start = 10 + Math.floor(random() * (shaped.length - 45));
    const length = 8 + Math.floor(random() * 14);
    const factor = 1.35 + random() * 0.85;
    // Ramp over three days, hold, then recover, so the EWMA has a signal to
    // follow rather than a step change.
    for (let offset = 0; offset < length; offset++) {
      const day = start + offset;
      if (day >= shaped.length) break;
      const ramp = Math.min(1, (offset + 1) / 3) * Math.min(1, (length - offset) / 3);
      shaped[day] = Math.round(shaped[day] * (1 + (factor - 1) * ramp));
    }
  }

  return shaped;
}

/**
 * Deliveries are mostly on time but sometimes slip, which is the behaviour the
 * lead-time leg of the score exists to anticipate.
 */
function drawLeadTime(medicine: Medicine, random: () => number): number {
  const history = medicine.supplier.leadTimeHistory;
  const observed = history.length > 0 ? history.reduce((sum, value) => sum + value, 0) / history.length : medicine.supplier.contractedLeadTimeDays;
  const jittered = observed * (0.85 + random() * 0.35);
  const slipped = random() < 0.16 ? jittered * (1.5 + random() * 0.6) : jittered;
  return Math.max(1, Math.round(slipped));
}

/**
 * The forecast can only use what a pharmacist could see on the shelf, so a
 * review copy carries the simulated holding and the dispensed history, and
 * nothing else. Parking the whole holding in the central store keeps ward
 * allocation out of the comparison.
 *
 * The store's par level is set *equal to the holding*, and that is load
 * bearing. `availableStock` subtracts `strandedStock`, which counts every unit
 * held above a ward's par as unreachable, because it cannot serve a short ward
 * without a transfer. A single facility store can serve any ward, so it must
 * never read as stranded. Leaving par at zero subtracted the entire shelf and
 * drove `availableStock` to 0 on all 305 scored days, which pinned DIR at 0
 * and the score at 100 for every molecule — a replay in which the metric was
 * never actually consulted.
 */
function reviewCopy(
  medicine: Medicine,
  onHand: number,
  history: number[],
  reorderThreshold: number,
): Medicine {
  return {
    ...medicine,
    currentStock: onHand,
    allocatedStock: 0,
    consumptionHistory: history,
    reorderThreshold,
    wardStock: [{ ward: "CENTRAL_STORE", quantity: onHand, parLevel: onHand }],
  };
}

/**
 * Re-scale a seeded demand profile to the replay window.
 *
 * The seeded drift describes growth across a 30-day window. Compounding that
 * over a year would imply a four-fold rise in demand, which no formulary sees,
 * so the intended growth is preserved and the annual figure is capped at 35%.
 */
function rescaleProfile(profile: ConsumptionProfile, days: number): ConsumptionProfile {
  const originalDays = profile.days ?? 30;
  const intendedGrowth = (1 + profile.drift) ** originalDays - 1;
  const cappedGrowth = Math.min(Math.max(intendedGrowth, -0.2), 0.35);
  const drift = (1 + cappedGrowth) ** (1 / days) - 1;
  return { ...profile, drift, days };
}

interface MoleculeRun {
  observations: DayObservation[];
  events: SimulatedEvent[];
  demand: number[];
}

function simulate(
  medicine: Medicine,
  profile: ConsumptionProfile,
  options: BacktestOptions,
  windowStartMs: number,
): MoleculeRun {
  const random = createRandom(seedFor(options.seed, medicine.id));
  const demand = applyDemandWaves(
    buildConsumption(rescaleProfile(profile, options.days)),
    options.demandWaves,
    random,
  );
  const meanDemand = demand.reduce((sum, value) => sum + value, 0) / Math.max(demand.length, 1);

  // The seeded trigger level and order size were written for the demo's opening
  // position. Lift them to what the simulated demand actually needs, so neither
  // method is judged against a shelf that could never keep up.
  const reorderThreshold = Math.max(
    medicine.reorderThreshold,
    Math.ceil(meanDemand * medicine.supplier.contractedLeadTimeDays * 1.15),
  );
  const orderQuantity = Math.max(medicine.economicOrderQuantity, Math.ceil(meanDemand * 21));

  // Start from a full shelf against the trigger level, so neither method is
  // judged on the seeded (already critical) opening position.
  let onHand = reorderThreshold + orderQuantity;
  const inFlight: { arrivalDay: number; quantity: number }[] = [];
  const observations: DayObservation[] = [];
  const events: SimulatedEvent[] = [];
  const dispensed: number[] = [];

  const dayIndex = (iso: string): number | null => {
    const parsed = new Date(iso).getTime();
    if (Number.isNaN(parsed)) return null;
    return Math.round((parsed - windowStartMs) / DAY_MS);
  };

  for (let day = 0; day < options.days; day++) {
    // 1. The morning review: state at the start of the day, history to yesterday.
    if (day >= options.warmupDays) {
      const assessment = assessMedicine(reviewCopy(medicine, onHand, dispensed.slice(-30), reorderThreshold), {
        referenceDate: new Date(windowStartMs + day * DAY_MS),
      });
      observations.push({
        day,
        onHand,
        sps: assessment.sps,
        dir: assessment.dir,
        predictedStockoutDay: dayIndex(assessment.projectedStockoutDate),
        flagged: options.flagTiers.includes(riskTierFromScore(assessment.sps)),
        // The rule most hospitals run: act when the shelf hits the reorder level.
        baselineFlagged: onHand <= reorderThreshold,
      });
    }

    // 2. Demand is exogenous; an empty shelf means the demand went unserved.
    const wanted = demand[day] ?? 0;
    const served = Math.min(onHand, wanted);
    const unmet = wanted - served;
    onHand -= served;
    // The score reads demand, not units handed over the counter: during a
    // stockout the counter records the shortage, not the demand behind it, and
    // feeding it the dispensed figure would hide the surge the model must see.
    dispensed.push(wanted);

    if (unmet > 0) {
      const last = events[events.length - 1];
      if (last && last.end === day - 1) {
        last.end = day;
        last.unitsShort += unmet;
      } else {
        events.push({ start: day, end: day, unitsShort: unmet });
      }
    }

    // 3. Arrivals, then the ordering policy — identical for both methods.
    for (let index = inFlight.length - 1; index >= 0; index--) {
      if (inFlight[index].arrivalDay <= day) {
        onHand += inFlight[index].quantity;
        inFlight.splice(index, 1);
      }
    }

    const pipeline = inFlight.reduce((sum, order) => sum + order.quantity, 0);
    if (onHand + pipeline <= reorderThreshold) {
      inFlight.push({
        arrivalDay: day + drawLeadTime(medicine, random),
        quantity: orderQuantity,
      });
    }
  }

  return { observations, events, demand };
}

/* ------------------------------------------------------------------ */
/* Scoring                                                             */
/* ------------------------------------------------------------------ */

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? Math.round(((sorted[middle - 1] + sorted[middle]) / 2) * 10) / 10 : sorted[middle];
}

/** A run of consecutive flagged days. */
interface EpisodeSpan {
  start: number;
  end: number;
  peakSps: number;
}

/** Collapse runs of consecutive flagged days into discrete warning episodes. */
function warningEpisodes(
  observations: DayObservation[],
  flagged: (observation: DayObservation) => boolean,
): EpisodeSpan[] {
  const episodes: EpisodeSpan[] = [];
  const days = observations.filter(flagged);

  for (const observation of days) {
    const last = episodes[episodes.length - 1];
    if (last && observation.day <= last.end + 1) {
      last.end = observation.day;
      last.peakSps = Math.max(last.peakSps, observation.sps);
    } else {
      episodes.push({ start: observation.day, end: observation.day, peakSps: observation.sps });
    }
  }

  return episodes;
}

interface ScoreInput {
  label: string;
  description: string;
  events: SimulatedEvent[];
  episodes: EpisodeSpan[];
  observations: DayObservation[];
  horizonDays: number;
  scoredDays: number;
  /** Whether this method predicts a stockout date that can be checked. */
  hasDateEstimate?: boolean;
}

/**
 * Per-molecule counters, kept separate from `MethodScore` so molecules can be
 * aggregated by *summing counters* rather than by pooling their raw days.
 *
 * Event-level and warning-level counters are deliberately distinct. An event is
 * a stockout; a warning is one continuous flagged run. Two episodes can bracket
 * the same event and one long episode can span several, so neither number can
 * be derived from the other, and collapsing them would hide both failure modes.
 */
interface MethodTally {
  label: string;
  description: string;
  hasDateEstimate: boolean;
  scoredDays: number;
  /** Stockout events in this molecule's replay. */
  events: number;
  /** Events with a flag raised somewhere in the window before them. */
  caught: number;
  /** Continuous flagged runs. */
  warnings: number;
  /** Runs that intersect at least one event's warning window. */
  hits: number;
  /** Days of notice, one per caught event. */
  earlyDays: number[];
  /** Absolute error of the projected stockout date, one per checkable event. */
  dateErrors: number[];
}

const round1 = (value: number): number => Math.round(value * 10) / 10;

/**
 * Resolve one molecule's warnings against one molecule's events.
 *
 * The criterion is: *was a flag active at any point in the `horizonDays` before
 * the stockout?* That is the question a ward actually asks, and it is not the
 * same as "did a warning finish before the stockout began".
 *
 * The earlier implementation required an episode to end strictly before the
 * event began, which silently scored every correct warning as a miss: both
 * methods here keep flagging while the shelf is short, so their flagged runs
 * extend through the stockout itself and never satisfied that test. Both
 * methods reported 0% recall against 11 real events, which is the signature of
 * a broken criterion rather than two broken algorithms.
 *
 * Notice is measured from the *earliest flagged day inside the window*, so
 * lead time is never inflated by a molecule that sat in the high band for six
 * months, and every value is bounded by the horizon being tested.
 */
function tallyMethod(input: ScoreInput): MethodTally {
  const { events, episodes, observations, horizonDays, hasDateEstimate = true } = input;
  const predictedByDay = new Map(
    observations.map((observation) => [observation.day, observation.predictedStockoutDay]),
  );

  const windows = events.map((event) => ({ event, from: event.start - horizonDays, to: event.start }));
  /** A flagged run intersects a window when the two day ranges overlap. */
  const intersects = (span: EpisodeSpan, window: { from: number; to: number }): boolean =>
    span.start <= window.to && span.end >= window.from;

  const earlyDays: number[] = [];
  const dateErrors: number[] = [];
  let caught = 0;

  for (const window of windows) {
    const overlapping = episodes.filter((episode) => intersects(episode, window));
    if (overlapping.length === 0) continue;

    caught += 1;
    const firstFlag = Math.min(...overlapping.map((episode) => Math.max(episode.start, window.from)));
    earlyDays.push(window.event.start - firstFlag);

    const prediction = predictedByDay.get(firstFlag) ?? null;
    if (hasDateEstimate && prediction !== null) {
      dateErrors.push(Math.abs(prediction - window.event.start));
    }
  }

  return {
    label: input.label,
    description: input.description,
    hasDateEstimate,
    scoredDays: input.scoredDays,
    events: events.length,
    caught,
    warnings: episodes.length,
    hits: episodes.filter((episode) => windows.some((window) => intersects(episode, window))).length,
    earlyDays,
    dateErrors,
  };
}

function toScore(tally: MethodTally): MethodScore {
  const falseAlarms = tally.warnings - tally.hits;
  const months = Math.max(tally.scoredDays / 30, 1);

  return {
    label: tally.label,
    description: tally.description,
    events: tally.events,
    caught: tally.caught,
    missed: tally.events - tally.caught,
    recall: tally.events === 0 ? 0 : round1((tally.caught / tally.events) * 100),
    warnings: tally.warnings,
    hits: tally.hits,
    falseAlarms,
    precision: tally.warnings === 0 ? 0 : round1((tally.hits / tally.warnings) * 100),
    falseAlarmsPerMonth: round1(falseAlarms / months),
    medianDaysEarly: median(tally.earlyDays),
    medianDateErrorDays: tally.hasDateEstimate ? median(tally.dateErrors) : null,
  };
}

/**
 * Fold per-molecule tallies into one facility-level score.
 *
 * Counters are summed and the day-level arrays concatenated, which is only
 * sound because every episode and every event already belongs to exactly one
 * molecule. The earlier implementation pooled raw observations from all
 * molecules into one list, which let molecule A's warning be credited with
 * molecule B's stockout and collapsed every molecule's predicted date onto a
 * shared day index.
 */
function combineTallies(tallies: MethodTally[], meta: {
  label: string;
  description: string;
  hasDateEstimate: boolean;
  scoredDays: number;
}): MethodScore {
  return toScore({
    ...meta,
    events: tallies.reduce((sum, tally) => sum + tally.events, 0),
    caught: tallies.reduce((sum, tally) => sum + tally.caught, 0),
    warnings: tallies.reduce((sum, tally) => sum + tally.warnings, 0),
    hits: tallies.reduce((sum, tally) => sum + tally.hits, 0),
    earlyDays: tallies.flatMap((tally) => tally.earlyDays),
    dateErrors: tallies.flatMap((tally) => tally.dateErrors),
  });
}

const METHOD_LABEL = "Triangulated SPS";
const METHOD_DESCRIPTION =
  "EWMA burn rate, dynamic lead-time slippage, regional pressure and buffer depletion; warns at the high band or above.";
const BASELINE_LABEL = "Reorder-threshold rule";
const BASELINE_DESCRIPTION =
  "Acts when the shelf reaches the reorder level. No forecast, no lead-time awareness — the incumbent practice.";

/* ------------------------------------------------------------------ */
/* Public entry point                                                  */
/* ------------------------------------------------------------------ */

export interface BacktestInput {
  medicines: Medicine[];
  /** Demand profiles keyed by medicine id; falls back to the seeded history. */
  profiles: Record<string, ConsumptionProfile>;
  options?: Partial<BacktestOptions>;
}

/** A simulated molecule, retained so it can be re-scored at other horizons. */
interface SimulatedRunInputs {
  events: SimulatedEvent[];
  observations: DayObservation[];
  methodEpisodes: EpisodeSpan[];
  baselineEpisodes: EpisodeSpan[];
}

/** Warning horizons reported on the curve, in days. */
const HORIZON_STEPS = [3, 7, 14, 21, 30];

/**
 * Score both methods over every molecule at one horizon.
 *
 * Resolution happens per molecule and aggregation afterwards, so widening the
 * warning window re-matches episodes against their own molecule's events.
 */
function scoreAtHorizon(
  runs: SimulatedRunInputs[],
  horizonDays: number,
  scoredDays: number,
): { method: MethodScore; baseline: MethodScore } {
  const methodTallies: MethodTally[] = [];
  const baselineTallies: MethodTally[] = [];

  for (const run of runs) {
    methodTallies.push(
      tallyMethod({
        label: METHOD_LABEL,
        description: METHOD_DESCRIPTION,
        events: run.events,
        episodes: run.methodEpisodes,
        observations: run.observations,
        horizonDays,
        scoredDays,
      }),
    );
    baselineTallies.push(
      tallyMethod({
        label: BASELINE_LABEL,
        description: BASELINE_DESCRIPTION,
        hasDateEstimate: false,
        events: run.events,
        episodes: run.baselineEpisodes,
        observations: run.observations,
        horizonDays,
        scoredDays,
      }),
    );
  }

  return {
    method: combineTallies(methodTallies, {
      label: METHOD_LABEL,
      description: METHOD_DESCRIPTION,
      hasDateEstimate: true,
      scoredDays,
    }),
    baseline: combineTallies(baselineTallies, {
      label: BASELINE_LABEL,
      description: BASELINE_DESCRIPTION,
      hasDateEstimate: false,
      scoredDays,
    }),
  };
}

export function runBacktest({ medicines, profiles, options: overrides }: BacktestInput): BacktestResult {
  const options: BacktestOptions = { ...DEFAULT_BACKTEST_OPTIONS, ...overrides };

  // Anchored to local midnight so a replay is reproducible within the day
  // rather than shifting with the wall clock.
  const todayMs = new Date().setHours(0, 0, 0, 0);
  const windowStartMs = new Date(todayMs - (options.days - 1) * DAY_MS).setHours(0, 0, 0, 0);
  const scoredDays = options.days - options.warmupDays;

  const molecules: MoleculeBacktest[] = [];
  const allEvents: BacktestEvent[] = [];
  const runs: SimulatedRunInputs[] = [];

  for (const medicine of medicines) {
    const profile =
      profiles[medicine.id] ??
      ({ seed: 7, baseline: 6, drift: 0, jitter: 0.18, days: options.days } satisfies ConsumptionProfile);

    const run = simulate(medicine, profile, options, windowStartMs);
    const methodEpisodes = warningEpisodes(run.observations, (observation) => observation.flagged);
    const baselineEpisodes = warningEpisodes(run.observations, (observation) => observation.baselineFlagged);

    runs.push({ events: run.events, observations: run.observations, methodEpisodes, baselineEpisodes });

    const method = toScore(
      tallyMethod({
        label: METHOD_LABEL,
        description: METHOD_DESCRIPTION,
        events: run.events,
        episodes: methodEpisodes,
        observations: run.observations,
        horizonDays: options.horizonDays,
        scoredDays,
      }),
    );
    const baseline = toScore(
      tallyMethod({
        label: BASELINE_LABEL,
        description: BASELINE_DESCRIPTION,
        hasDateEstimate: false,
        events: run.events,
        episodes: baselineEpisodes,
        observations: run.observations,
        horizonDays: options.horizonDays,
        scoredDays,
      }),
    );

    const demand = run.demand.slice(options.warmupDays);
    const eventDays = new Set(run.events.flatMap((event) => [event.start, event.end]));

    molecules.push({
      medicineId: medicine.id,
      brandName: medicine.brandName,
      sku: medicine.sku,
      events: run.events.length,
      method,
      baseline,
      meanDailyDemand: Math.round((demand.reduce((sum, value) => sum + value, 0) / Math.max(demand.length, 1)) * 10) / 10,
      observedMinCoverDays: Math.round(Math.min(...run.observations.map((observation) => observation.dir)) * 10) / 10,
      timeline: run.observations.map((observation) => ({
        day: observation.day,
        date: new Date(windowStartMs + observation.day * DAY_MS).toISOString(),
        onHand: observation.onHand,
        coverDays: Math.round(observation.dir * 10) / 10,
        sps: Math.round(observation.sps * 10) / 10,
        flagged: observation.flagged,
        baselineFlagged: observation.baselineFlagged,
        stockout: eventDays.has(observation.day),
      })),
    });

    for (const event of run.events) {
      allEvents.push({
        medicineId: medicine.id,
        brandName: medicine.brandName,
        day: event.start,
        date: new Date(windowStartMs + event.start * DAY_MS).toISOString(),
        unitsShort: event.unitsShort,
      });
    }

  }

  const { method: aggregate, baseline: baselineAggregate } = scoreAtHorizon(
    runs,
    options.horizonDays,
    scoredDays,
  );

  const horizonCurve = HORIZON_STEPS.map((horizonDays) => {
    const { method, baseline } = scoreAtHorizon(runs, horizonDays, scoredDays);
    return {
      horizonDays,
      methodRecall: method.recall,
      baselineRecall: baseline.recall,
      methodPrecision: method.precision,
      baselinePrecision: baseline.precision,
    };
  });

  return {
    window: {
      start: new Date(windowStartMs).toISOString(),
      end: new Date(todayMs).toISOString(),
      days: options.days,
      scoredDays,
    },
    options,
    method: aggregate,
    baseline: baselineAggregate,
    molecules: molecules.sort((a, b) => b.events - a.events || a.brandName.localeCompare(b.brandName)),
    events: allEvents.sort((a, b) => a.day - b.day),
    horizonCurve,
  };
}
