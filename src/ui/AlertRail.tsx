/**
 * Shortage alert rail.
 *
 * The engine produces a live critical/high alert per molecule; this rail is the
 * push surface for those alerts plus the pending redistribution proposals. The
 * counter in the masthead reflects unacknowledged alerts only, so acknowledging
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
          "relative grid h-9 w-9 place-items-center border transition",
          open ? "border-accent bg-accent-soft text-accent" : "border-rule-strong bg-paper text-ink-500 hover:bg-canvas",
        )}
      >
        <Icon name="bell" size={17} />
        {count > 0 ? (
          <span className="absolute -right-1.5 -top-1.5 grid h-4 min-w-4 place-items-center border border-paper bg-risk-critical px-1 text-[10px] font-bold text-white">
            {count}
          </span>
        ) : null}
      </button>

      {open ? (
        <div
          role="dialog"
          aria-label="Shortage alerts"
          className="absolute right-0 z-40 mt-2 w-[26rem] animate-rise-in overflow-hidden border border-rule-strong bg-paper shadow-sheet"
        >
          <div className="flex items-center justify-between border-b border-rule bg-canvas px-4 py-3">
            <div>
              <p className="sm-eyebrow">Risk feed</p>
              <p className="mt-1 text-[11px] text-ink-500">
                {derived.portfolio.critical} critical &middot; {derived.portfolio.high} high &middot; peak risk index{" "}
                {derived.portfolio.peakScore}/100
              </p>
            </div>
            {canViewShortage ? (
              <Button
                size="sm"
                variant="secondary"
                onClick={() => {
                  actions.setView(HOME_VIEW[state.session.role]);
                  setOpen(false);
                }}
              >
                Open board
              </Button>
            ) : null}
          </div>

          <div className="max-h-[26rem] space-y-2.5 overflow-y-auto p-3">
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
                <article key={alert.id} className="border border-rule bg-paper p-3" style={{ borderLeftWidth: 3, borderLeftColor: token.hex }}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-ink-900">{alert.drugName}</p>
                      <p className="mt-1 text-[11px] leading-relaxed text-ink-500">{alert.message}</p>
                    </div>
                    <span className={cx("sm-chip shrink-0", token.chip)}>{token.label}</span>
                  </div>
                  {assessment ? (
                    <p className="mt-2 border-t border-rule-soft pt-2 text-[11px] text-ink-400">
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
              <div className="border border-accent/40 bg-accent-soft p-3">
                <p className="sm-eyebrow text-accent">Pending redistribution</p>
                <p className="mt-1 text-[11px] leading-relaxed text-ink-700">
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
