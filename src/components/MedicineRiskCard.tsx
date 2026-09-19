/**
 * Shortage drill-down card.
 *
 * Shows one molecule's forecast end to end: the headline score and days of
 * cover, the four triangulated signals that produced it, ward-level cover, the
 * EWMA burn curve against its pre-surge baseline, and the playbook action.
 */

import { useState } from "react";
import type { Medicine, RiskAssessment } from "@/types";
import { WARD_LABELS } from "@/types";
import { RISK_TOKENS } from "@/ui/theme";
import { Button, Chip, ProgressBar, SignalMeter } from "@/ui/primitives";
import Sparkline from "@/charts/Sparkline";
import LineChart from "@/charts/LineChart";
import Icon from "@/ui/Icon";
import { cx, formatDate, percent } from "@/utils/format";
import { WARD_AT_RISK_DAYS, formatDays } from "@/engine/shortageEngine";

export interface MedicineRiskCardProps {
  assessment: RiskAssessment;
  medicine: Medicine;
  /** Generic names of the in-stock therapeutic equivalents. */
  alternativeLabels?: string[];
  /** Renders the panel open on first paint. */
  defaultOpen?: boolean;
}

const DRIVER_COLORS: Record<string, string> = {
  burn: "#a4232b",
  lead: "#a1590f",
  regional: "#5a3a7a",
  buffer: "#8a6a06",
};

export default function MedicineRiskCard({
  assessment,
  medicine,
  alternativeLabels = [],
  defaultOpen = false,
}: MedicineRiskCardProps) {
  const [open, setOpen] = useState(defaultOpen);
  const token = RISK_TOKENS[assessment.tier];

  const burnSeries = assessment.burnSeries;
  const baselineSeries = burnSeries.map(() => assessment.baselineBurnRate);
  const dayLabels = burnSeries.map((_, index) => `D-${burnSeries.length - 1 - index}`);

  const coverage = assessment.coverageByWard;

  return (
    <article className={cx("sm-panel overflow-hidden", open && "ring-1 ring-inset ring-rule")}>
      {/* Headline row. */}
      <div className="flex flex-wrap items-start gap-4 p-4">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-semibold text-ink-900">{assessment.brandName}</h3>
            <Chip token={token} />
            <span className="text-[11px] text-ink-400">{assessment.sku}</span>
            {medicine.controlledSubstance ? (
              <span className="sm-chip border-rule-strong bg-paper text-ink-700">Controlled</span>
            ) : null}
          </div>
          <p className="mt-1 text-xs text-ink-500">
            {assessment.genericName} · {medicine.strength} · {medicine.form.replace(/_/g, " ")}
          </p>

          <div className="mt-3 grid grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-4">
            <div>
              <p className="text-[10px] uppercase tracking-[0.14em] text-ink-400">Risk Score (0-100)</p>
              <p className="text-lg font-semibold tabular-nums" style={{ color: token.hex }}>
                {assessment.sps}
              </p>
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-[0.14em] text-ink-400">Stock Left (Days)</p>
              <p className="text-lg font-semibold tabular-nums text-ink-900">{formatDays(assessment.dir)}d</p>
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-[0.14em] text-ink-400">Supplier Delivery</p>
              <p className="text-lg font-semibold tabular-nums text-ink-900">
                {assessment.dynamicLeadTimeDays.toFixed(1)}d
              </p>
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-[0.14em] text-ink-400">Daily Hospital Usage</p>
              <p className="text-lg font-semibold tabular-nums text-ink-900">
                {assessment.dailyBurnRate.toFixed(1)}
                <span className="ml-1 text-[10px] font-normal text-ink-400">units/day</span>
              </p>
            </div>
          </div>
        </div>

        <div className="flex w-full shrink-0 items-center justify-between gap-4 sm:w-auto sm:flex-col sm:items-end">
          <Sparkline
            values={burnSeries}
            stroke={token.hex}
            fill={`${token.hex}22`}
            height={40}
            className="w-28"
            ariaLabel={`${assessment.brandName} burn rate trend`}
          />
          <Button size="sm" variant="ghost" onClick={() => setOpen((value) => !value)}>
            <Icon name={open ? "close" : "search"} size={13} />
            {open ? "Hide Details" : "View Breakdown"}
          </Button>
        </div>
      </div>

      {/* Signal summary strip, always visible. */}
      <div className="grid gap-px border-t border-rule bg-paper sm:grid-cols-4">
        {assessment.drivers.map((driver) => (
          <div key={driver.code} className="bg-surface px-4 py-2.5">
            <p className="text-[10px] uppercase tracking-[0.12em] text-ink-400">{driver.label}</p>
            <p className="mt-1 flex items-baseline gap-1.5 text-xs">
              <span className="font-semibold tabular-nums text-ink-900">{driver.points.toFixed(1)}</span>
              <span className="text-ink-400">/ {driver.maxPoints} pts weight</span>
            </p>
            <ProgressBar
              value={driver.points}
              max={driver.maxPoints}
              color={DRIVER_COLORS[driver.code] ?? "#14416b"}
              className="mt-1.5"
              height={3}
            />
          </div>
        ))}
      </div>

      {open ? (
        <div className="space-y-4 border-t border-rule p-4">
          {/* Plain English summary callout */}
          <div className={cx(
            "rounded-lg border p-3 text-xs leading-relaxed",
            assessment.tier === "critical"
              ? "border-risk-critical/30 bg-risk-critical/[0.05] text-ink-900"
              : assessment.tier === "high"
              ? "border-risk-high/30 bg-risk-high/[0.05] text-ink-900"
              : "border-rule bg-surface text-ink-800"
          )}>
            <p className="font-semibold flex items-center gap-1.5 mb-1">
              <Icon name="info" size={14} className={assessment.tier === "critical" ? "text-risk-critical" : "text-accent"} />
              Plain-English Situation Summary:
            </p>
            <p>
              {assessment.dir < assessment.dynamicLeadTimeDays ? (
                <>
                  Current stock runs out in <strong>{formatDays(assessment.dir)} days</strong>, but supplier refills require <strong>{assessment.dynamicLeadTimeDays.toFixed(1)} days</strong> to arrive.
                  This leaves a dangerous <strong>{(assessment.dynamicLeadTimeDays - assessment.dir).toFixed(1)}-day stockout gap</strong> unless an emergency transfer or fast-track order is dispatched immediately.
                </>
              ) : (
                <>
                  Current stock covers <strong>{formatDays(assessment.dir)} days</strong> against a <strong>{assessment.dynamicLeadTimeDays.toFixed(1)}-day</strong> delivery window.
                  Inventory levels are manageable, but consumption trends should continue to be monitored.
                </>
              )}
            </p>
          </div>

          {/* Playbook action. */}
          <div className="rounded-lg border border-rule bg-paper p-3">
            <p className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-ink-500">
              <Icon name="bolt" size={12} className="text-accent" />
              Recommended Action
            </p>
            <p className="mt-1.5 text-xs leading-relaxed text-ink-900">{assessment.recommendation}</p>
            <dl className="mt-3 grid gap-x-6 gap-y-2 text-[11px] sm:grid-cols-3">
              <div>
                <dt className="text-ink-400">Projected stockout</dt>
                <dd className="text-ink-900">{formatDate(assessment.projectedStockoutDate)}</dd>
              </div>
              <div>
                <dt className="text-ink-400">Order by</dt>
                <dd className="text-ink-900">{formatDate(assessment.reorderByDate)}</dd>
              </div>
              <div>
                <dt className="text-ink-400">Supplier</dt>
                <dd className="text-ink-900">
                  {medicine.supplier.name} · reliability {medicine.supplier.reliabilityIndex.toFixed(2)}
                </dd>
              </div>
            </dl>
          </div>

          {/* Signal evidence. */}
          <div>
            <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-ink-500">
              Risk Factors &amp; Diagnostics · Impact Score {assessment.psi.toFixed(1)}/100
            </p>
            <div className="grid gap-2 lg:grid-cols-2">
              {assessment.drivers.map((driver) => (
                <SignalMeter
                  key={driver.code}
                  label={driver.label}
                  detail={driver.detail}
                  points={driver.points}
                  maxPoints={driver.maxPoints}
                  color={DRIVER_COLORS[driver.code] ?? "#14416b"}
                />
              ))}
            </div>
          </div>

          {/* Stock ledger. */}
          <div className="grid gap-4 lg:grid-cols-2">
            <div>
              <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-ink-500">
                Current Inventory Breakdown
              </p>
              <dl className="space-y-1.5 text-xs">
                {[
                  { label: "Physical stock in pharmacy", value: `${medicine.currentStock} ${medicine.unit}` },
                  { label: "Reserved for active patient prescriptions", value: `${medicine.allocatedStock} ${medicine.unit}` },
                  {
                    label: "Excess buffer stored in wards",
                    value: `${assessment.strandedUnits} ${medicine.unit}`,
                  },
                  {
                    label: "Immediately available to dispense",
                    value: (
                      <span className="font-semibold text-accent">
                        {assessment.availableStock} {medicine.unit}
                      </span>
                    ),
                  },
                  { label: "Automated reorder point", value: `${medicine.reorderThreshold} ${medicine.unit}` },
                  { label: "Standard order batch size", value: `${medicine.economicOrderQuantity} ${medicine.unit}` },
                ].map((row) => (
                  <div key={row.label} className="flex items-center justify-between gap-4 border-b border-rule-soft pb-1.5">
                    <dt className="text-ink-500">{row.label}</dt>
                    <dd className="tabular-nums text-ink-900">{row.value}</dd>
                  </div>
                ))}
              </dl>
              {alternativeLabels.length > 0 ? (
                <p className="mt-3 text-[11px] leading-relaxed text-ink-500">
                  <span className="font-semibold text-ink-700">In-stock alternative medicines:</span>{" "}
                  {alternativeLabels.join(", ")}
                </p>
              ) : null}
            </div>

            <div>
              <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-ink-500">
                Ward Stock Coverage · {assessment.wardsAtRisk} ward(s) under {WARD_AT_RISK_DAYS} days
              </p>
              <ul className="space-y-2">
                {coverage.map((ward) => (
                  <li key={ward.ward}>
                    <div className="flex items-baseline justify-between gap-3 text-[11px]">
                      <span className="truncate text-ink-700">{WARD_LABELS[ward.ward]}</span>
                      <span className="shrink-0 tabular-nums text-ink-500">
                        <span className={ward.atRisk ? "font-semibold text-risk-critical" : "text-ink-900"}>
                          {formatDays(ward.coverDays)}d left
                        </span>{" "}
                        · {ward.quantity}/{ward.parLevel} target
                      </span>
                    </div>
                    <ProgressBar
                      value={Math.min(ward.coverDays, 7)}
                      max={7}
                      color={ward.atRisk ? RISK_TOKENS.critical.hex : RISK_TOKENS.normal.hex}
                      className="mt-1"
                      height={3}
                    />
                  </li>
                ))}
              </ul>
            </div>
          </div>

          {/* Burn curve. */}
          <div>
            <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-ink-500">
              Daily Usage Trend vs Normal Average · {percent(assessment.burnTrendPct, 1)} surge
            </p>
            <LineChart
              height={200}
              series={[
                {
                  key: "baseline",
                  label: "Normal Historical Average",
                  color: "#a1a7af",
                  dashed: true,
                  points: baselineSeries.map((value, index) => ({ label: dayLabels[index], value })),
                },
                {
                  key: "ewma",
                  label: "Recent Daily Consumption Rate",
                  color: token.hex,
                  area: true,
                  points: burnSeries.map((value, index) => ({ label: dayLabels[index], value })),
                },
              ]}
              valueFormat={(value) => `${value.toFixed(1)}/day`}
              ariaLabel={`${assessment.brandName} consumption trend`}
            />
          </div>
        </div>
      ) : null}
    </article>
  );
}
