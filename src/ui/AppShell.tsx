/**
 * Application shell.
 *
 * Owns the persistent chrome: the letterhead masthead, the role-aware document
 * index down the left, and the session controls. The shell renders no clinical
 * content itself, so each portal page stays focused on its own workflow.
 */

import { useEffect, useState, type ReactNode } from "react";
import { useApp } from "@/store/AppStore";
import { useSession } from "@/store/SessionProvider";
import { ROLE_META, RISK_TOKENS } from "@/ui/theme";
import { HOME_VIEW, NAV_BY_ROLE, findNavItem } from "@/ui/navigation";
import RoleSwitcher from "@/ui/RoleSwitcher";
import AlertRail from "@/ui/AlertRail";
import Icon from "@/ui/Icon";
import { Button, Select } from "@/ui/primitives";
import { cx, displayName, initials } from "@/utils/format";
import { formatDays } from "@/engine/shortageEngine";
import { BRANDING } from "@/config/branding";

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
    <div className="hidden min-w-[12rem] sm:block">
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
      <div className="hidden items-center gap-2 border border-rule bg-paper px-2.5 py-1.5 md:flex">
        <Icon name="user" size={14} className="text-ink-400" />
        <span className="text-xs text-ink-700">
          {patient ? `${patient.name} · ${patient.mrn}` : "No patient linked"}
        </span>
      </div>
    );
  }

  const patients = state.db.patients;
  return (
    <div className="hidden min-w-[14rem] md:block">
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
      <span className="hidden items-center gap-2 border border-risk-normal/40 bg-risk-normal/[0.06] px-2.5 py-1.5 text-xs text-risk-normal lg:flex">
        <Icon name="check" size={13} />
        All molecules inside tolerance
      </span>
    );
  }

  return (
    <span className="hidden items-center gap-2 border border-risk-critical/40 bg-risk-critical/[0.06] px-2.5 py-1.5 text-xs text-risk-critical lg:flex">
      <Icon name="alert" size={13} />
      <span className="font-semibold">{portfolio.critical} critical</span>
      <span className="text-rule-strong">|</span>
      <span>{portfolio.high} high</span>
      <span className="text-rule-strong">|</span>
      <span>peak SPS {portfolio.peakScore}</span>
    </span>
  );
}

/**
 * Write-through indicator.
 *
 * Optimistic UI is only defensible if the operator can see when a change has
 * not reached the database, so a failed write is stated plainly with a way back.
 */
function SyncIndicator() {
  const { sync, actions } = useApp();

  if (sync.error) {
    return (
      <button
        type="button"
        onClick={actions.resync}
        title={sync.error}
        className="inline-flex items-center gap-1.5 border border-risk-critical/40 bg-risk-critical/[0.06] px-2.5 py-1.5 text-xs text-risk-critical"
      >
        <Icon name="alert" size={12} />
        Save failed &middot; retry
      </button>
    );
  }

  if (sync.pending > 0) {
    return (
      <span className="inline-flex items-center gap-1.5 border border-rule bg-paper px-2.5 py-1.5 text-xs text-ink-500">
        <span className="h-3 w-3 animate-spin border border-ink-300 border-t-accent" />
        Saving
      </span>
    );
  }

  return null;
}

export default function AppShell({ children }: { children: ReactNode }) {
  const { state, derived, actions, sync, profile, mode } = useApp();
  const { signOut } = useSession();
  const role = state.session.role;
  // A patient account holds one patient's record; the role switcher and the
  // supply alert rail are staff affordances and are withheld from it.
  const isPatientAccount = profile?.role === "patient";
  const meta = ROLE_META[role];
  const nav = NAV_BY_ROLE[role];
  const active = findNavItem(role, state.activeView);
  const clock = useClock();

  const criticalCount = derived.assessments.filter((item) => item.tier === "critical").length;
  const worst = derived.assessments[0];

  return (
    <div className="flex min-h-screen flex-col bg-canvas">
      {/* Institutional spine: the one full-bleed colour band in the system. */}
      <div className="no-print h-1 shrink-0 bg-accent" />

      {/* ---------------------------------------------------------- */}
      {/* Masthead                                                    */}
      {/* ---------------------------------------------------------- */}
      <header className="no-print sticky top-0 z-30 bg-paper sm-masthead-rule">
        <div className="mx-auto flex max-w-[110rem] flex-wrap items-center gap-4 px-4 py-2.5 lg:px-6">
          <div className="flex items-center gap-3">
            <span
              className="grid h-10 w-10 shrink-0 place-items-center border bg-accent text-white"
              style={{ borderColor: BRANDING.accent }}
              title={BRANDING.organisation}
            >
              <Icon name="vitals" size={19} />
            </span>
            <div className="leading-tight">
              <p className="font-serif text-xl font-semibold tracking-tight text-ink-900">{BRANDING.name}</p>
              <p className="text-[10px] uppercase tracking-[0.14em] text-ink-400">{BRANDING.tagline}</p>
            </div>
          </div>

          <div className="ml-auto flex flex-wrap items-center gap-2">
            <ActingAsSelector />
            <ActivePatientSelector />
            <RiskSummary />
            <span className="hidden items-center gap-1.5 border border-rule bg-paper px-2.5 py-1.5 text-xs text-ink-500 xl:flex">
              <Icon name="refresh" size={12} className="text-ink-400" />
              {clock}
            </span>
            <SyncIndicator />
            {isPatientAccount ? null : <AlertRail />}
            {isPatientAccount ? null : <RoleSwitcher />}
          </div>
        </div>

        {/* Session strip: who you are acting as right now. */}
        <div className="border-t border-rule-soft bg-canvas">
          <div className="mx-auto flex max-w-[110rem] flex-wrap items-center gap-x-4 gap-y-1 px-4 py-1.5 text-[11px] lg:px-6">
            <span className="inline-flex items-center gap-1.5 font-medium text-ink-700">
              <span className="h-2 w-2" style={{ background: meta.accent }} />
              {meta.persona}
            </span>
            <span className="hidden text-ink-400 sm:inline">{meta.summary}</span>
            {worst && (role === "admin" || role === "doctor") ? (
              <span className="ml-auto inline-flex items-center gap-1.5 text-ink-500">
                <Icon name="alert" size={12} className="text-risk-critical" />
                Highest risk: <span className="font-semibold text-ink-900">{worst.brandName}</span> at{" "}
                {worst.sps} SPS ({formatDays(worst.dir)} days cover)
              </span>
            ) : null}
            {sync.error ? (
              <span className="w-full text-risk-critical sm:ml-auto sm:w-auto">
                {sync.error} The record has been reloaded from the database.
              </span>
            ) : null}
          </div>
        </div>
      </header>

      {/* ---------------------------------------------------------- */}
      {/* Body                                                        */}
      {/* ---------------------------------------------------------- */}
      <div className="mx-auto flex w-full max-w-[110rem] flex-1 flex-col gap-5 px-4 py-4 lg:flex-row lg:px-6">
        {/* Document index: sidebar on desktop, scrolling strip on mobile. */}
        <nav className="no-print -mx-4 shrink-0 px-4 lg:mx-0 lg:w-64 lg:px-0">
          <p className="mb-2 hidden text-[10px] font-semibold uppercase tracking-[0.16em] text-ink-400 lg:block">
            Contents
          </p>
          <div className="flex gap-1 overflow-x-auto pb-1 lg:block lg:space-y-0.5 lg:overflow-visible lg:pb-0">
            {nav.map((item) => {
              const isActive = item.id === active.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => actions.setView(item.id)}
                  className={cx(
                    "flex w-full min-w-max items-center gap-2.5 border-l-2 px-3 py-2 text-left transition lg:min-w-0",
                    isActive
                      ? "border-accent bg-accent-soft text-ink-900"
                      : "border-transparent text-ink-700 hover:border-rule hover:bg-paper",
                  )}
                >
                  <span className={cx("shrink-0", isActive ? "text-accent" : "text-ink-400")}>
                    <Icon name={item.icon} size={16} />
                  </span>
                  <span className="min-w-0">
                    <span className={cx("block truncate text-xs", isActive ? "font-semibold" : "font-medium")}>
                      {item.label}
                    </span>
                    <span className="hidden truncate text-[10px] text-ink-400 lg:block">{item.description}</span>
                  </span>
                </button>
              );
            })}
          </div>

          {/* Sidebar footer: live counters and demo controls. */}
          <div className="no-print mt-4 hidden space-y-3 lg:block">
            {role === "admin" || role === "doctor" ? (
              <div className="border border-rule bg-paper p-3">
                <p className="sm-eyebrow">Formulary status</p>
                <table className="mt-2 w-full">
                  <tbody>
                    {(["critical", "high", "moderate", "normal"] as const).map((tier) => {
                      const count = derived.assessments.filter((item) => item.tier === tier).length;
                      const token = RISK_TOKENS[tier];
                      return (
                        <tr key={tier} className="border-b border-rule-soft last:border-0">
                          <td className="py-1.5 text-[11px] text-ink-700">
                            <span className="inline-flex items-center gap-2">
                              <span className="h-2 w-2" style={{ background: token.hex }} />
                              {token.label}
                            </span>
                          </td>
                          <td className="py-1.5 text-right text-[11px] font-semibold text-ink-900">{count}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                {criticalCount > 0 ? (
                  <p className="mt-2.5 border-t border-rule-soft pt-2 text-[10px] leading-relaxed text-ink-500">
                    {derived.proposals.length} redistribution
                    {derived.proposals.length === 1 ? "" : "s"} pending approval.
                  </p>
                ) : null}
              </div>
            ) : null}

            <div className="border border-rule bg-paper p-3">
              <p className="sm-eyebrow">Data source</p>
              <p className="mt-1.5 text-[10px] leading-relaxed text-ink-500">
                {mode === "supabase"
                  ? "Every change is written to the hospital database and appended to the audit ledger."
                  : "No database is configured, so the API is serving the seeded dataset in memory."}
              </p>
              {sync.lastSyncedAt ? (
                <p className="mt-1.5 text-[10px] text-ink-400">
                  Last write accepted at{" "}
                  {new Date(sync.lastSyncedAt).toLocaleTimeString("en-GB", {
                    hour: "2-digit",
                    minute: "2-digit",
                    second: "2-digit",
                  })}
                  .
                </p>
              ) : null}
              {profile?.role === "admin" ? (
                <Button size="sm" variant="secondary" fullWidth className="mt-2" onClick={actions.resetDemo}>
                  <Icon name="refresh" size={12} />
                  Reset to seeded state
                </Button>
              ) : null}
            </div>

            <div className="border border-rule bg-paper p-3">
              <p className="sm-eyebrow">Signed in</p>
              <div className="mt-2 flex items-center gap-2.5">
                <span
                  className="grid h-8 w-8 shrink-0 place-items-center text-[11px] font-bold text-white"
                  style={{ background: meta.accent }}
                >
                  {initials(profile?.fullName ?? "User")}
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-xs font-medium text-ink-900">
                    {displayName(profile?.fullName ?? "Unknown account")}
                  </span>
                  <span className="block truncate text-[10px] text-ink-400">{profile?.email ?? ""}</span>
                </span>
              </div>

              <p className="mt-2 border-t border-rule-soft pt-2 text-[10px] leading-relaxed text-ink-500">
                Acting as{" "}
                <span className="font-medium text-ink-700">
                  {role === "patient"
                    ? (derived.currentPatient?.name ?? "Patient portal")
                    : displayName(derived.currentStaff?.fullName ?? "\u2014")}
                </span>{" "}
                &middot; {meta.label}
              </p>

              <Button size="sm" variant="secondary" fullWidth className="mt-2" onClick={() => void signOut()}>
                Sign out
              </Button>
            </div>

            <p className="px-1 text-[10px] leading-relaxed text-ink-400">
              {BRANDING.organisation}
            </p>
          </div>
        </nav>

        {/* Main content. */}
        <main className="min-w-0 flex-1">
          <div className="no-print mb-4 border-b border-rule pb-3">
            <p className="sm-eyebrow">
              {meta.label} portal &nbsp;/&nbsp; {active.label}
            </p>
            <h1 className="mt-1 text-[26px] leading-tight">{active.label}</h1>
            <p className="mt-1 max-w-3xl text-xs leading-relaxed text-ink-500">{active.description}</p>
          </div>
          <div className="animate-rise-in space-y-4 pb-12">{children}</div>
        </main>
      </div>

      <footer className="no-print border-t border-rule bg-paper px-4 py-3 text-center text-[10px] leading-relaxed text-ink-400 lg:px-6">
        {BRANDING.name} {BRANDING.documentTitle} &middot; v{BRANDING.version} &middot; {BRANDING.provenance} Staff
        accounts can switch roles from the masthead to follow one encounter end to end.
        {state.session.role !== "patient" ? (
          <span className="ml-1">
            <button
              type="button"
              className="text-accent underline decoration-dotted hover:text-accent-deep"
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
