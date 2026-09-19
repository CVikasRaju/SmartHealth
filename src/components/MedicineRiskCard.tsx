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
  burn: "#f43f5e",
  lead: "#fb923c",
  regional: "#a78bfa",
  buffer: "#facc15",
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
    <article className={cx("sm-panel overflow-hidden", open && "ring-1 ring-inset ring-white/10")}>
      {/* Headline row. */}
      <div className="flex flex-wrap items-start gap-4 p-4">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-semibold text-white">{assessment.brandName}</h3>
            <Chip token={token} />
            <span className="text-[11px] text-slate-500">{assessment.sku}</span>
            {medicine.controlledSubstance ? (
              <span className="sm-chip border-violet-400/40 bg-violet-500/15 text-violet-200">Controlled</span>
            ) : null}
          </div>
          <p className="mt-1 text-xs text-slate-400">
            {assessment.genericName} · {medicine.strength} · {medicine.form.replace(/_/g, " ")}
          </p>

          <div className="mt-3 grid grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-4">
            <div>
              <p className="text-[10px] uppercase tracking-[0.14em] text-slate-500">SPS score</p>
              <p className="text-lg font-semibold tabular-nums" style={{ color: token.hex }}>
                {assessment.sps}
              </p>
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-[0.14em] text-slate-500">Days of cover</p>
              <p className="text-lg font-semibold tabular-nums text-white">{formatDays(assessment.dir)}</p>
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-[0.14em] text-slate-500">Dynamic lead time</p>
              <p className="text-lg font-semibold tabular-nums text-slate-200">
                {assessment.dynamicLeadTimeDays.toFixed(1)}d
              </p>
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-[0.14em] text-slate-500">EWMA burn rate</p>
              <p className="text-lg font-semibold tabular-nums text-slate-200">
                {assessment.dailyBurnRate.toFixed(1)}
                <span className="ml-1 text-[10px] font-normal text-slate-500">/day</span>
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
            {open ? "Hide evidence" : "Show evidence"}
          </Button>
        </div>
      </div>

      {/* Signal summary strip, always visible. */}
      <div className="grid gap-px border-t border-white/10 bg-white/[0.04] sm:grid-cols-4">
        {assessment.drivers.map((driver) => (
          <div key={driver.code} className="bg-surface-800/90 px-4 py-2.5">
            <p className="text-[10px] uppercase tracking-[0.12em] text-slate-500">{driver.label}</p>
            <p className="mt-1 flex items-baseline gap-1.5 text-xs">
              <span className="font-semibold tabular-nums text-slate-100">{driver.points.toFixed(1)}</span>
              <span className="text-slate-500">/ {driver.maxPoints} pts</span>
            </p>
            <ProgressBar
              value={driver.points}
              max={driver.maxPoints}
              color={DRIVER_COLORS[driver.code] ?? "#22d3ee"}
              className="mt-1.5"
              height={3}
            />
          </div>
        ))}
      </div>

      {open ? (
        <div className="space-y-4 border-t border-white/10 p-4">
          {/* Playbook action. */}
          <div className="rounded-lg border border-white/10 bg-white/[0.02] p-3">
            <p className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400">
              <Icon name="bolt" size={12} className="text-accent" />
              Playbook action
            </p>
            <p className="mt-1.5 text-xs leading-relaxed text-slate-200">{assessment.recommendation}</p>
            <dl className="mt-3 grid gap-x-6 gap-y-2 text-[11px] sm:grid-cols-3">
              <div>
                <dt className="text-slate-500">Projected stockout</dt>
                <dd className="text-slate-200">{formatDate(assessment.projectedStockoutDate)}</dd>
              </div>
              <div>
                <dt className="text-slate-500">Order by</dt>
                <dd className="text-slate-200">{formatDate(assessment.reorderByDate)}</dd>
              </div>
              <div>
                <dt className="text-slate-500">Supplier</dt>
                <dd className="text-slate-200">
                  {medicine.supplier.name} · reliability {medicine.supplier.reliabilityIndex.toFixed(2)}
                </dd>
              </div>
            </dl>
          </div>

          {/* Signal evidence. */}
          <div>
            <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400">
              Triangulated signals · Psi {assessment.psi.toFixed(1)}
            </p>
            <div className="grid gap-2 lg:grid-cols-2">
              {assessment.drivers.map((driver) => (
                <SignalMeter
                  key={driver.code}
                  label={driver.label}
                  detail={driver.detail}
                  points={driver.points}
                  maxPoints={driver.maxPoints}
                  color={DRIVER_COLORS[driver.code] ?? "#22d3ee"}
                />
              ))}
            </div>
          </div>

          {/* Stock ledger. */}
          <div className="grid gap-4 lg:grid-cols-2">
            <div>
              <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400">
                Stock position
              </p>
              <dl className="space-y-1.5 text-xs">
                {[
                  { label: "Physical on hand", value: `${medicine.currentStock} ${medicine.unit}` },
                  { label: "Soft reserved", value: `${medicine.allocatedStock} ${medicine.unit}` },
                  {
                    label: "Stranded above ward par",
                    value: `${assessment.strandedUnits} ${medicine.unit}`,
                  },
                  {
                    label: "Effective available",
                    value: (
                      <span className="font-semibold text-accent">
                        {assessment.availableStock} {medicine.unit}
                      </span>
                    ),
                  },
                  { label: "Reorder threshold", value: `${medicine.reorderThreshold} ${medicine.unit}` },
                  { label: "Economic order quantity", value: `${medicine.economicOrderQuantity} ${medicine.unit}` },
                ].map((row) => (
                  <div key={row.label} className="flex items-center justify-between gap-4 border-b border-white/5 pb-1.5">
                    <dt className="text-slate-400">{row.label}</dt>
                    <dd className="tabular-nums text-slate-200">{row.value}</dd>
                  </div>
                ))}
              </dl>
              {alternativeLabels.length > 0 ? (
                <p className="mt-3 text-[11px] leading-relaxed text-slate-400">
                  <span className="font-semibold text-slate-300">Therapeutic equivalents on hand:</span>{" "}
                  {alternativeLabels.join(", ")}
                </p>
              ) : null}
            </div>

            <div>
              <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400">
                Ward cover · {assessment.wardsAtRisk} ward(s) under {WARD_AT_RISK_DAYS} days
              </p>
              <ul className="space-y-2">
                {coverage.map((ward) => (
                  <li key={ward.ward}>
                    <div className="flex items-baseline justify-between gap-3 text-[11px]">
                      <span className="truncate text-slate-300">{WARD_LABELS[ward.ward]}</span>
                      <span className="shrink-0 tabular-nums text-slate-400">
                        <span className={ward.atRisk ? "font-semibold text-rose-300" : "text-slate-200"}>
                          {formatDays(ward.coverDays)}d
                        </span>{" "}
                        · {ward.quantity}/{ward.parLevel} par
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
            <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400">
              EWMA consumption vs pre-surge baseline · {percent(assessment.burnTrendPct, 1)} change
            </p>
            <LineChart
              height={200}
              series={[
                {
                  key: "baseline",
                  label: "Pre-surge baseline",
                  color: "#94a3b8",
                  dashed: true,
                  points: baselineSeries.map((value, index) => ({ label: dayLabels[index], value })),
                },
                {
                  key: "ewma",
                  label: "EWMA burn rate (α 0.35)",
                  color: token.hex,
                  area: true,
                  points: burnSeries.map((value, index) => ({ label: dayLabels[index], value })),
                },
              ]}
              valueFormat={(value) => value.toFixed(1)}
              ariaLabel={`${assessment.brandName} EWMA burn rate`}
            />
          </div>
        </div>
      ) : null}
    </article>
  );
}
