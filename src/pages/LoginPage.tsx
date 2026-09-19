/**
 * Sign-in page.
 *
 * Professional healthcare access control supporting both regional multi-hospital
 * governance and hospital-level clinical operations with strict data isolation.
 */

import { useState, type FormEvent } from "react";

import { BRANDING } from "@/config/branding";
import { useSession } from "@/store/SessionProvider";
import { ROLE_META } from "@/ui/theme";
import Icon from "@/ui/Icon";
import { Button, Field, TextInput } from "@/ui/primitives";
import { cx } from "@/utils/format";

/** Accounts provisioned by `npm run seed`, for evaluators. */
const SEEDED_ACCOUNTS = [
  { role: "superadmin", email: "superadmin@smartmedic.io", label: "Super Admin (Platform Governance)" },
  { role: "admin", email: "meera.krishnan@smartmedic.io", label: "Hospital Admin (KMC Hospital)" },
  { role: "doctor", email: "dr.sharma@smartmedic.io", label: "Doctor (Pulmonology / OPD)" },
  { role: "nurse", email: "fatima.sheikh@smartmedic.io", label: "Nurse (ICU & Wards)" },
  { role: "receptionist", email: "kavya.nair@smartmedic.io", label: "Receptionist (Front Desk / Triage)" },
  { role: "cashier", email: "arjun.deshpande@smartmedic.io", label: "Cashier (Billing & POS)" },
  { role: "patient", email: "priya.sharma@example.com", label: "Patient (Health Record Portal)" },
] as const;

function Letterhead() {
  return (
    <div className="border-rule px-6 py-8 lg:border-r lg:px-10 lg:py-12 flex flex-col justify-between">
      <div>
        <div className="flex items-center gap-3">
          <span className="grid h-11 w-11 shrink-0 place-items-center border border-accent bg-accent text-white shadow-sm">
            <Icon name="vitals" size={22} />
          </span>
          <div className="leading-tight">
            <p className="font-serif text-2xl font-semibold tracking-tight text-ink-900">{BRANDING.name}</p>
            <p className="text-[10px] uppercase tracking-[0.14em] text-ink-400 font-medium">{BRANDING.organisation}</p>
          </div>
        </div>

        <hr className="my-6 border-0 border-t border-rule" />

        <h1 className="font-serif text-[26px] leading-snug text-ink-900 font-normal">
          Unified Healthcare Operations, Shortage Intelligence &amp; Clinical Portals
        </h1>
        <p className="mt-3 max-w-md text-xs leading-relaxed text-ink-600">
          A modern multi-tenant healthcare system built for clinical precision and supply resilience. Role-based access ensures strict patient health privacy while enabling regional hospital governance and predictive inventory management.
        </p>

        <ul className="mt-6 space-y-3">
          {(
            [
              ["superadmin", "Multi-hospital network governance, facility onboarding & zero-PHI privacy."],
              ["admin", "Hospital shortage control room, disruption sandbox and audit trail."],
              ["doctor", "Outpatient queue and prescription entry with live stock guards & substitutes."],
              ["nurse", "Bedside eMAR medication rounds, vitals capture and ward inventory."],
              ["receptionist", "Patient registration, appointment scheduling and emergency triage."],
              ["cashier", "Itemised hospital billing, POS payment processing and daily reconciliation."],
              ["patient", "Laboratory test report simplifier and longitudinal health trends."],
            ] as const
          ).map(([role, description]) => (
            <li key={role} className="flex items-start gap-2.5 text-xs leading-relaxed">
              <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full" style={{ background: ROLE_META[role].accent }} />
              <div>
                <span className="font-semibold text-ink-800">
                  {ROLE_META[role].label}
                </span>
                <span className="text-ink-500"> &mdash; {description}</span>
              </div>
            </li>
          ))}
        </ul>
      </div>

      <p className="mt-8 border-t border-rule-soft pt-4 text-[10px] leading-relaxed text-ink-400">
        {BRANDING.name} {BRANDING.documentTitle} &middot; v{BRANDING.version} &middot; {BRANDING.provenance}
      </p>
    </div>
  );
}

/** Demo mode: choose a seeded identity. No credentials exist to check. */
function DemoIdentityPicker() {
  const { demoProfiles, demoProfilesLoading, signInAs } = useSession();
  const [busy, setBusy] = useState<string | null>(null);

  if (demoProfilesLoading) {
    return <p className="text-xs text-ink-400">Loading seeded identities&hellip;</p>;
  }

  if (demoProfiles.length === 0) {
    return (
      <p className="border border-risk-critical/40 bg-risk-critical/[0.05] px-3 py-2.5 text-xs leading-relaxed text-risk-critical">
        The API did not return any demo identities. Start it with <code className="font-mono">npm run dev:api</code>{" "}
        or run <code className="font-mono">npm run dev:stack</code>.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <div className="border border-rule bg-canvas px-3 py-2.5 text-[11px] leading-relaxed text-ink-600 rounded">
        <span className="font-semibold text-ink-800">Local Evaluation Mode.</span> Select any role below to instantly enter the portal:
      </div>

      <div className="divide-y divide-rule-soft border border-rule rounded overflow-hidden">
        {demoProfiles.map((profile) => {
          const meta = ROLE_META[profile.role];
          return (
            <button
              key={profile.id}
              type="button"
              disabled={busy !== null}
              onClick={() => {
                setBusy(profile.id);
                void signInAs(profile.id).catch(() => setBusy(null));
              }}
              className={cx(
                "flex w-full items-center gap-3 px-3.5 py-2.5 text-left transition hover:bg-accent-soft disabled:opacity-50",
              )}
            >
              <span className="h-7 w-1.5 shrink-0 rounded-full" style={{ background: meta.accent }} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-xs font-semibold text-ink-900">{profile.fullName}</span>
                <span className="block truncate text-[10px] text-ink-400">{profile.email}</span>
              </span>
              <span
                className="shrink-0 text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded border border-rule bg-paper"
                style={{ color: meta.accent }}
              >
                {busy === profile.id ? "Entering..." : meta.label}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** Supabase mode: a real email and password check. */
function PasswordForm() {
  const { signIn } = useSession();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const fillAccount = (accEmail: string) => {
    setEmail(accEmail);
    setPassword("SmartMedic@2026");
    setError(null);
  };

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await signIn(email, password);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Sign-in failed. Please verify credentials.");
      setBusy(false);
    }
  }

  return (
    <form className="space-y-4" onSubmit={(event) => void handleSubmit(event)}>
      <Field label="Hospital or Patient Email">
        <TextInput
          type="email"
          value={email}
          onChange={setEmail}
          placeholder="name@smartmedic.io"
          required
        />
      </Field>

      <Field label="Password" error={error ?? undefined}>
        <TextInput type="password" value={password} onChange={setPassword} placeholder="••••••••" required />
      </Field>

      <Button type="submit" variant="primary" fullWidth disabled={busy}>
        <Icon name="user" size={13} />
        {busy ? "Verifying..." : "Sign in to Portal"}
      </Button>

      <div className="border border-rule bg-canvas p-3 rounded">
        <div className="flex items-center justify-between">
          <p className="text-[11px] font-semibold text-ink-700">
            Demo &amp; Evaluator Logins
          </p>
          <span className="text-[10px] text-ink-400">Password: <code className="font-mono text-ink-700">SmartMedic@2026</code></span>
        </div>
        <p className="mt-1 text-[10px] text-ink-500">
          Click any role below to auto-fill the login form:
        </p>
        <div className="mt-2.5 space-y-1.5">
          {SEEDED_ACCOUNTS.map((account) => {
            const meta = ROLE_META[account.role];
            return (
              <button
                key={account.email}
                type="button"
                onClick={() => fillAccount(account.email)}
                className="flex w-full items-center justify-between rounded border border-rule bg-paper px-2.5 py-1.5 text-left text-xs transition hover:border-accent hover:bg-accent-soft"
              >
                <div className="min-w-0 flex items-center gap-2">
                  <span className="h-2 w-2 rounded-full shrink-0" style={{ background: meta.accent }} />
                  <span className="font-medium text-ink-800 truncate">{account.label}</span>
                </div>
                <span className="text-[10px] font-mono text-accent shrink-0 ml-2">Click to Fill</span>
              </button>
            );
          })}
        </div>
      </div>
    </form>
  );
}

export default function LoginPage() {
  const { mode, configured, status, error } = useSession();

  if (status === "loading") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-canvas text-xs text-ink-400">
        Checking session status&hellip;
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col bg-canvas">
      <div className="h-1 shrink-0 bg-accent" />
      <div className="flex flex-1 items-center justify-center px-4 py-8 lg:px-8">
        <div className="grid w-full max-w-5xl border border-rule bg-paper shadow-panel lg:grid-cols-[1.15fr_1fr]">
          <Letterhead />

          <div className="px-6 py-8 lg:px-10 lg:py-12 flex flex-col justify-between">
            <div>
              <p className="sm-eyebrow">Identity &amp; Access</p>
              <h2 className="mt-1 font-serif text-2xl text-ink-900">Sign in to your account</h2>
              <p className="mt-1.5 text-xs leading-relaxed text-ink-500">
                {configured
                  ? "Enter your hospital staff or patient credentials to access your designated workspace."
                  : "Serving seeded offline demonstration dataset."}
              </p>

              <div className="mt-6">
                {configured ? <PasswordForm /> : <DemoIdentityPicker />}
              </div>

              {error ? (
                <p className="mt-4 border border-risk-critical/40 bg-risk-critical/[0.05] px-3 py-2 text-[11px] leading-relaxed text-risk-critical">
                  {error}
                </p>
              ) : null}
            </div>

            <p className="mt-6 border-t border-rule-soft pt-4 text-[10px] leading-relaxed text-ink-400">
              Session Mode: <span className="font-medium text-ink-700">{mode}</span>.{" "}
              {configured
                ? "Secured with Supabase Auth cryptographic verification."
                : "Seeded demo mode with simulated role-based isolation."}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
