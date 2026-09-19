/**
 * Shortage alert rail.
 *
 * The engine produces a live critical/high alert per molecule; this rail is the
 * push surface for those alerts plus the pending redistribution proposals. The
 * counter in the top bar reflects unacknowledged alerts only, so acknowledging
 * one genuinely clears the badge.
 */

import { useRef, useState } from "react";
import { useApp } from "@/store/AppStore";
import { RISK_TOKENS } from "@/ui/theme";
import { HOME_VIEW } from "@/ui/navigation";
import { useClickOutside } from "@/ui/hooks";
import Icon from "@/ui/Icon";
import { Button, EmptyState } from "@/ui/primitives";
import { cx } from "@/utils/format";
import { formatDays } from "@/engine/shortageEngine";

export default function AlertRail() {
  const { state, derived, actions } = useApp();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useClickOutside(containerRef, () => setOpen(false), open);

  const canViewShortage = state.session.role === "admin" || state.session.role === "doctor";
  const count = derived.alerts.length + derived.proposals.length;

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-haspopup="dialog"
        aria-expanded={open}
        title="Shortage alerts"
        className={cx(
          "relative grid h-9 w-9 place-items-center rounded-lg border transition",
          open ? "border-accent/50 bg-accent/10 text-accent" : "border-white/12 bg-white/[0.04] text-slate-300 hover:border-white/25",
        )}
      >
        <Icon name="bell" size={17} />
        {count > 0 ? (
          <span className="absolute -right-1 -top-1 grid h-4 min-w-4 place-items-center rounded-full bg-rose-500 px-1 text-[10px] font-bold text-white">
            {count}
          </span>
        ) : null}
      </button>

      {open ? (
        <div
          role="dialog"
          aria-label="Shortage alerts"
          className="absolute right-0 z-40 mt-2 w-[26rem] animate-rise-in overflow-hidden rounded-xl border border-white/12 bg-surface-800/98 shadow-2xl backdrop-blur"
        >
          <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400">Risk feed</p>
              <p className="mt-0.5 text-[11px] text-slate-400">
                {derived.portfolio.critical} critical · {derived.portfolio.high} high · peak SPS{" "}
                {derived.portfolio.peakScore}
              </p>
            </div>
            {canViewShortage ? (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  actions.setView(HOME_VIEW[state.session.role]);
                  setOpen(false);
                }}
              >
                Open board
              </Button>
            ) : null}
          </div>

          <div className="max-h-[26rem] space-y-3 overflow-y-auto p-3">
            {derived.alerts.length === 0 && derived.proposals.length === 0 ? (
              <EmptyState
                title="No open alerts"
                description="Every molecule is inside its tolerance band and no redistribution is pending."
              />
            ) : null}

            {derived.alerts.map((alert) => {
              const token = RISK_TOKENS[alert.tier];
              const assessment = derived.assessmentById.get(alert.medicineId);
              return (
                <article key={alert.id} className="rounded-lg border border-white/10 bg-white/[0.02] p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="flex items-center gap-2 text-sm font-semibold text-white">
                        <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: token.hex }} />
                        <span className="truncate">{alert.drugName}</span>
                      </p>
                      <p className="mt-1 text-[11px] leading-relaxed text-slate-400">{alert.message}</p>
                    </div>
                    <span className={cx("sm-chip shrink-0", token.chip)}>{token.label}</span>
                  </div>
                  {assessment ? (
                    <p className="mt-2 text-[11px] text-slate-500">
                      {assessment.strandedUnits > 0
                        ? `${assessment.strandedUnits} units stranded above ward par · ${assessment.wardsAtRisk} ward(s) under 3 days cover`
                        : `Cover ${formatDays(assessment.dir)} days against a ${assessment.dynamicLeadTimeDays.toFixed(1)}-day lead time`}
                    </p>
                  ) : null}
                  <div className="mt-3 flex justify-end">
                    <Button size="sm" variant="secondary" onClick={() => actions.acknowledgeAlert(alert)}>
                      Acknowledge
                    </Button>
                  </div>
                </article>
              );
            })}

            {derived.proposals.length > 0 ? (
              <div className="rounded-lg border border-accent/25 bg-accent/[0.06] p-3">
                <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-accent/90">
                  Pending redistribution
                </p>
                <p className="mt-1 text-[11px] leading-relaxed text-slate-300">
                  {derived.proposals.length} inter-ward transfer
                  {derived.proposals.length === 1 ? "" : "s"} can release stranded stock into wards that are short.
                  Approve them from the control room.
                </p>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
