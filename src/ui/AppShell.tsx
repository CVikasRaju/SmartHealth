/**
 * Application shell.
 *
 * Owns the persistent chrome: the role-aware navigation rail, the top bar with
 * the role switcher and acting-staff selectors, and the live risk summary. The
 * shell renders no clinical content itself, so each portal page stays focused
 * on its own workflow.
 */

import { useEffect, useState, type ReactNode } from "react";
import { useApp } from "@/store/AppStore";
import { ROLE_META, RISK_TOKENS } from "@/ui/theme";
import { HOME_VIEW, NAV_BY_ROLE, findNavItem } from "@/ui/navigation";
import RoleSwitcher from "@/ui/RoleSwitcher";
import AlertRail from "@/ui/AlertRail";
import Icon from "@/ui/Icon";
import { Button, Select } from "@/ui/primitives";
import { cx, displayName, initials } from "@/utils/format";
import { formatDays } from "@/engine/shortageEngine";

/** Live clock, refreshed on a slow interval to keep the demo feeling alive. */
function useClock(): string {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 20_000);
    return () => window.clearInterval(timer);
  }, []);
  return now.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
}

function ActingAsSelector() {
  const { state, derived, actions } = useApp();
  const role = state.session.role;

  if (role === "patient") return null;

  // Only offered when the role has more than one member on the roster, so the
  // single-doctor roles do not carry a dead-end control.
  const members = derived.doctors.filter((member) => member.role === role).length > 0
    ? derived.doctors
    : Array.from(derived.staffById.values()).filter((member) => member.role === role);
  if (members.length <= 1) return null;

  return (
    <div className="hidden min-w-[13rem] sm:block">
      <Select
        value={state.session.staffId}
        onChange={(value) => actions.setActiveStaff(value)}
        options={members.map((member) => ({ value: member.id, label: member.fullName }))}
      />
    </div>
  );
}

function ActivePatientSelector() {
  const { state, derived, actions } = useApp();
  const role = state.session.role;

  if (role === "patient") {
    const patient = derived.currentPatient;
    return (
      <div className="hidden items-center gap-2 rounded-lg border border-white/12 bg-white/[0.04] px-3 py-2 md:flex">
        <Icon name="user" size={15} className="text-slate-400" />
        <span className="text-xs text-slate-200">
          {patient ? `${patient.name} · ${patient.mrn}` : "No patient linked"}
        </span>
      </div>
    );
  }

  const patients = state.db.patients;
  return (
    <div className="hidden min-w-[15rem] md:block">
      <Select
        value={state.session.patientId}
        onChange={(value) => actions.setActivePatient(value)}
        options={patients.map((patient) => ({
          value: patient.id,
          label: `${patient.name} · ${patient.mrn}`,
        }))}
      />
    </div>
  );
}

/** Compact risk summary shown beside the clock for supply-facing roles. */
function RiskSummary() {
  const { state, derived } = useApp();
  const role = state.session.role;
  if (role !== "admin" && role !== "doctor") return null;

  const { portfolio } = derived;
  if (portfolio.critical + portfolio.high === 0) {
    return (
      <span className="hidden items-center gap-2 rounded-lg border border-emerald-400/25 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-200 lg:flex">
        <Icon name="check" size={14} />
        All molecules inside tolerance
      </span>
    );
  }

  return (
    <span className="hidden items-center gap-2 rounded-lg border border-rose-400/25 bg-rose-500/10 px-3 py-2 text-xs text-rose-100 lg:flex">
      <Icon name="alert" size={14} />
      <span className="font-semibold">{portfolio.critical} critical</span>
      <span className="text-rose-200/70">·</span>
      <span>{portfolio.high} high</span>
      <span className="text-rose-200/70">·</span>
      <span>peak {portfolio.peakScore}</span>
    </span>
  );
}

export default function AppShell({ children }: { children: ReactNode }) {
  const { state, derived, actions } = useApp();
  const role = state.session.role;
  const meta = ROLE_META[role];
  const nav = NAV_BY_ROLE[role];
  const active = findNavItem(role, state.activeView);
  const clock = useClock();

  const criticalCount = derived.assessments.filter((item) => item.tier === "critical").length;
  const worst = derived.assessments[0];

  return (
    <div className="flex min-h-screen flex-col">
      {/* ---------------------------------------------------------- */}
      {/* Top bar                                                     */}
      {/* ---------------------------------------------------------- */}
      <header className="no-print sticky top-0 z-30 border-b border-white/10 bg-surface-900/85 backdrop-blur">
        <div className="mx-auto flex max-w-[110rem] flex-wrap items-center gap-3 px-4 py-2.5 lg:px-6">
          <div className="flex items-center gap-3">
            <span className="grid h-9 w-9 place-items-center rounded-lg bg-gradient-to-br from-accent to-accent-deep text-surface-900">
              <Icon name="vitals" size={19} />
            </span>
            <div className="leading-tight">
              <p className="text-sm font-semibold tracking-tight text-white">SmartMedic</p>
              <p className="hidden text-[10px] uppercase tracking-[0.16em] text-slate-500 sm:block">
                Hospital operations · shortage intelligence
              </p>
            </div>
          </div>

          <div className="ml-auto flex flex-wrap items-center gap-2">
            <ActingAsSelector />
            <ActivePatientSelector />
            <RiskSummary />
            <span className="hidden items-center gap-1.5 rounded-lg border border-white/12 bg-white/[0.04] px-3 py-2 text-xs tabular-nums text-slate-300 xl:flex">
              <Icon name="refresh" size={13} className="text-slate-500" />
              {clock}
            </span>
            <AlertRail />
            <RoleSwitcher />
          </div>
        </div>

        {/* Role summary strip: who you are acting as right now. */}
        <div className="border-t border-white/[0.06] bg-white/[0.015]">
          <div className="mx-auto flex max-w-[110rem] flex-wrap items-center gap-x-4 gap-y-1 px-4 py-1.5 text-[11px] lg:px-6">
            <span className="inline-flex items-center gap-1.5 text-slate-300">
              <span className="h-1.5 w-1.5 rounded-full" style={{ background: meta.accent }} />
              {meta.persona}
            </span>
            <span className="hidden text-slate-500 sm:inline">{meta.summary}</span>
            {worst && (role === "admin" || role === "doctor") ? (
              <span className="ml-auto inline-flex items-center gap-1.5 text-slate-400">
                <Icon name="alert" size={12} className="text-rose-400" />
                Highest risk: <span className="font-medium text-slate-200">{worst.brandName}</span> at{" "}
                {worst.sps} ({formatDays(worst.dir)} days cover)
              </span>
            ) : null}
          </div>
        </div>
      </header>

      {/* ---------------------------------------------------------- */}
      {/* Body                                                        */}
      {/* ---------------------------------------------------------- */}
      <div className="mx-auto flex w-full max-w-[110rem] flex-1 flex-col gap-6 px-4 py-5 lg:flex-row lg:px-6">
        {/* Navigation rail: sidebar on desktop, scrolling strip on mobile. */}
        <nav className="no-print -mx-4 shrink-0 px-4 lg:mx-0 lg:w-64 lg:px-0">
          <div className="flex gap-2 overflow-x-auto pb-1 lg:block lg:space-y-1.5 lg:overflow-visible lg:pb-0">
            {nav.map((item) => {
              const isActive = item.id === active.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => actions.setView(item.id)}
                  className={cx(
                    "flex w-full min-w-max items-center gap-3 rounded-lg border px-3 py-2.5 text-left transition lg:min-w-0",
                    isActive
                      ? "border-accent/35 bg-accent/10 text-white"
                      : "border-white/8 bg-white/[0.02] text-slate-300 hover:border-white/20 hover:bg-white/[0.05]",
                  )}
                >
                  <span className={cx("shrink-0", isActive ? "text-accent" : "text-slate-400")}>
                    <Icon name={item.icon} size={17} />
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-xs font-semibold">{item.label}</span>
                    <span className="hidden truncate text-[10px] text-slate-500 lg:block">
                      {item.description}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>

          {/* Sidebar footer: live counters and demo controls. */}
          <div className="no-print mt-4 hidden space-y-3 lg:block">
            {role === "admin" || role === "doctor" ? (
              <div className="rounded-lg border border-white/10 bg-white/[0.02] p-3">
                <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400">
                  Formulary pulse
                </p>
                <ul className="mt-2.5 space-y-1.5">
                  {(["critical", "high", "moderate", "normal"] as const).map((tier) => {
                    const count = derived.assessments.filter((item) => item.tier === tier).length;
                    const token = RISK_TOKENS[tier];
                    return (
                      <li key={tier} className="flex items-center justify-between text-[11px]">
                        <span className="inline-flex items-center gap-2 text-slate-300">
                          <span className="h-2 w-2 rounded-full" style={{ background: token.hex }} />
                          {token.label}
                        </span>
                        <span className="font-semibold tabular-nums text-slate-100">{count}</span>
                      </li>
                    );
                  })}
                </ul>
                {criticalCount > 0 ? (
                  <p className="mt-3 text-[10px] leading-relaxed text-slate-500">
                    {derived.proposals.length} redistribution
                    {derived.proposals.length === 1 ? "" : "s"} pending approval.
                  </p>
                ) : null}
              </div>
            ) : null}

            <div className="rounded-lg border border-white/10 bg-white/[0.02] p-3">
              <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400">Demo data</p>
              <p className="mt-1.5 text-[10px] leading-relaxed text-slate-500">
                All state lives in this browser. Reseed to restore the opening scenario.
              </p>
              <Button size="sm" variant="ghost" fullWidth className="mt-2" onClick={actions.resetDemo}>
                <Icon name="refresh" size={13} />
                Reset demo
              </Button>
            </div>

            <div className="rounded-lg border border-white/10 bg-white/[0.02] p-3">
              <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400">Signed in</p>
              <div className="mt-2 flex items-center gap-2.5">
                <span
                  className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-[11px] font-bold text-surface-900"
                  style={{ background: meta.accent }}
                >
                  {initials(role === "patient" ? (derived.currentPatient?.name ?? "Patient") : (derived.currentStaff?.fullName ?? "User"))}
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-xs font-medium text-slate-200">
                    {role === "patient"
                      ? (derived.currentPatient?.name ?? "Patient portal")
                      : displayName(derived.currentStaff?.fullName ?? "—")}
                  </span>
                  <span className="block truncate text-[10px] text-slate-500">
                    {role === "patient"
                      ? (derived.currentPatient?.mrn ?? "")
                      : (derived.currentStaff?.department ?? "")}
                  </span>
                </span>
              </div>
            </div>

            <p className="px-1 text-[10px] leading-relaxed text-slate-600">
              Prototype for demonstration. Not connected to any live clinical system.
            </p>
          </div>
        </nav>

        {/* Main content. */}
        <main className="min-w-0 flex-1">
          <div className="no-print mb-5">
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">
              {meta.label} · {active.label}
            </p>
            <h1 className="mt-1 text-xl font-semibold tracking-tight text-white">{active.label}</h1>
            <p className="mt-1 max-w-3xl text-xs leading-relaxed text-slate-400">{active.description}</p>
          </div>
          <div className="animate-rise-in space-y-6 pb-12">{children}</div>
        </main>
      </div>

      <footer className="no-print border-t border-white/[0.06] px-4 py-3 text-center text-[10px] text-slate-600 lg:px-6">
        SmartMedic prototype · seeded in-memory dataset · no live patient data · navigate between roles from the top bar
        to follow one encounter end to end.
        {state.session.role !== "patient" ? (
          <span className="ml-1">
            <button
              type="button"
              className="text-slate-500 underline decoration-dotted hover:text-accent"
              onClick={() => {
                actions.setRole("patient");
                actions.setActivePatient("patient-2");
                actions.setView(HOME_VIEW.patient);
              }}
            >
              Open the patient portal as Priya Sharma
            </button>
            .
          </span>
        ) : null}
      </footer>
    </div>
  );
}
