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
import ThemeToggle from "@/ui/ThemeToggle";
import { Button, Field, TextInput } from "@/ui/primitives";
import { cx } from "@/utils/format";

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

        {/* Scalability architecture */}
        <div className="mt-6 rounded-xl border border-accent/20 bg-accent-soft/30 p-3.5 space-y-2 text-xs">
          <div className="flex items-center gap-2">
            <span className="grid h-5 w-5 place-items-center rounded bg-accent text-white text-[10px] font-bold">
              ℹ️
            </span>
            <span className="font-bold text-ink-900">Scalable Production Architecture</span>
          </div>
          <p className="text-[11px] leading-relaxed text-ink-700">
            <strong>Built for scale:</strong> Designed for enterprise regional hospital networks with stateless API routes, isolated PostgreSQL schemas, Row-Level Security (RLS), and zero-PHI leak boundaries.
          </p>
          <p className="text-[11px] leading-relaxed text-ink-700">
            <strong>Access is issued by your hospital administrator.</strong> Accounts are provisioned centrally; this screen never displays or stores credentials.
          </p>
        </div>
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
        The API did not return any demo identities. Running locally, start it with{" "}
        <code className="font-mono">npm run dev:api</code> or <code className="font-mono">npm run dev:stack</code>.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <div className="rounded border border-rule bg-canvas/60 p-2.5 text-[11px] leading-relaxed text-ink-600">
        <span className="font-semibold text-ink-800">Local Evaluation Mode.</span> Select any role below to enter the portal:
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

/**
 * The API refused to run because it has no credentials.
 *
 * Reached when `/api/health` answers `not_configured`. Without this the page
 * offers a local developer hint, which is actively misleading on a deployment:
 * the API is reachable and the fix is a setting, not a running server.
 */
function MisconfiguredPanel({ message }: { message: string | null }) {
  return (
    <div className="space-y-3">
      <div className="rounded border border-risk-critical/40 bg-risk-critical/[0.05] px-3.5 py-3">
        <p className="text-xs font-semibold text-risk-critical">This deployment is not configured</p>
        <p className="mt-1.5 text-[11px] leading-relaxed text-ink-700">
          {message ?? "The API is running but refused to start because its credentials are missing."}
        </p>
      </div>

      <div className="rounded border border-rule bg-canvas/60 p-3.5">
        <p className="text-[11px] font-semibold text-ink-800">To fix it</p>
        <ol className="mt-2 space-y-1.5 text-[11px] leading-relaxed text-ink-600">
          <li>
            1. In Vercel, open this project → <span className="font-medium text-ink-800">Settings →
            Environment Variables</span>.
          </li>
          <li>
            2. Add <code className="font-mono">SUPABASE_URL</code>,{" "}
            <code className="font-mono">SUPABASE_ANON_KEY</code> and{" "}
            <code className="font-mono">SUPABASE_SERVICE_ROLE_KEY</code> for all three environments.
          </li>
          <li>
            3. <span className="font-medium text-ink-800">Redeploy.</span> Environment variables are
            read when a deployment is created, so an existing one will not pick them up.
          </li>
        </ol>
        <p className="mt-2.5 border-t border-rule-soft pt-2 text-[10px] leading-relaxed text-ink-400">
          Values are in Supabase under Project Settings → API. Full walkthrough:{" "}
          <code className="font-mono">docs/deployment.md</code>.
        </p>
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

      <p className="border-t border-rule-soft pt-3 text-[10.5px] leading-relaxed text-ink-500">
        Credentials are issued by your hospital administrator and verified by Supabase Auth. If you
        cannot sign in, contact your facility's IT desk.
      </p>
    </form>
  );
}

export default function LoginPage() {
  const { mode, configured, apiMisconfigured, status, error } = useSession();

  if (status === "loading") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-canvas text-xs text-ink-400">
        Checking session status&hellip;
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col bg-canvas text-ink-900">
      {/* Institutional spine */}
      <div className="h-1 shrink-0 bg-accent" />

      <div className="flex flex-1 items-center justify-center px-4 py-8 lg:px-8">
        <div className="grid w-full max-w-5xl rounded-lg border border-rule bg-paper shadow-sheet lg:grid-cols-[1.15fr_1fr] overflow-hidden">
          <Letterhead />

          <div className="flex flex-col justify-between px-6 py-8 lg:px-10 lg:py-12">
            <div>
              <div className="flex items-center justify-between">
                <p className="sm-eyebrow">Identity &amp; Access Control</p>
                <ThemeToggle />
              </div>
              <h2 className="mt-1 font-serif text-2xl font-semibold text-ink-900">Sign in to your portal</h2>
              <p className="mt-1.5 text-xs leading-relaxed text-ink-500">
                {apiMisconfigured
                  ? "The API is reachable but has no credentials, so no account can be checked."
                  : configured
                    ? "Enter the hospital email and password issued to you by your administrator."
                    : "Serving seeded offline demonstration dataset."}
              </p>

              <div className="mt-6">
                {apiMisconfigured ? (
                  <MisconfiguredPanel message={error} />
                ) : configured ? (
                  <PasswordForm />
                ) : (
                  <DemoIdentityPicker />
                )}
              </div>

              {error ? (
                <p className="mt-4 rounded border border-risk-critical/40 bg-risk-critical/[0.05] p-3 text-[11px] leading-relaxed text-risk-critical">
                  {error}
                </p>
              ) : null}
            </div>

            <p className="mt-6 border-t border-rule-soft pt-4 text-[10px] leading-relaxed text-ink-400">
              Session Mode:{" "}
              <span className="font-semibold text-ink-700">{apiMisconfigured ? "unavailable" : mode}</span>{" "}
              (reported by the API).{" "}
              {apiMisconfigured
                ? "No credentials are available in this deployment."
                : configured
                  ? "Secured with Supabase Auth cryptographic verification."
                  : "Seeded demo mode with simulated role-based isolation."}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
