/**
 * Sign-in page.
 *
 * The cover sheet of the record: institutional letterhead on the left, the
 * access control on the right. Two credential paths exist, and the page states
 * plainly which one this deployment is using, because "why can I get in without
 * a password?" is exactly the kind of ambiguity that undermines trust in a
 * clinical system.
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
  { role: "admin", email: "meera.krishnan@smartmedic.io" },
  { role: "doctor", email: "dr.sharma@smartmedic.io" },
  { role: "nurse", email: "fatima.sheikh@smartmedic.io" },
  { role: "receptionist", email: "kavya.nair@smartmedic.io" },
  { role: "cashier", email: "arjun.deshpande@smartmedic.io" },
  { role: "patient", email: "priya.sharma@example.com" },
] as const;

function Letterhead() {
  return (
    <div className="border-rule px-6 py-8 lg:border-r lg:px-10 lg:py-12">
      <div className="flex items-center gap-3">
        <span className="grid h-11 w-11 shrink-0 place-items-center border border-accent bg-accent text-white">
          <Icon name="vitals" size={21} />
        </span>
        <div className="leading-tight">
          <p className="font-serif text-2xl font-semibold tracking-tight text-ink-900">{BRANDING.name}</p>
          <p className="text-[10px] uppercase tracking-[0.14em] text-ink-400">{BRANDING.organisation}</p>
        </div>
      </div>

      <hr className="my-6 border-0 border-t border-rule" />

      <h1 className="font-serif text-[28px] leading-tight text-ink-900">
        Hospital operations, shortage intelligence and simplified reports in one record.
      </h1>
      <p className="mt-3 max-w-md text-xs leading-relaxed text-ink-500">
        Sign in to reach the portal your role is entitled to. Access is scoped on the server: a cashier cannot
        prescribe, a patient sees only their own results, and every clinical, supply and financial action is written to
        an audit ledger.
      </p>

      <ul className="mt-6 space-y-2.5">
        {(
          [
            ["admin", "Shortage control room, scenario sandbox and governance trail."],
            ["doctor", "OPD queue and computerised prescribing with live stock guards."],
            ["nurse", "Bedside eMAR round, vitals capture and ward holdings."],
            ["receptionist", "Patient registration, scheduling and triage."],
            ["cashier", "Itemised invoicing, POS collection and reconciliation."],
            ["patient", "Upload a lab report and read it in plain language."],
          ] as const
        ).map(([role, description]) => (
          <li key={role} className="flex gap-3 text-xs leading-relaxed">
            <span className="mt-1.5 h-2 w-2 shrink-0" style={{ background: ROLE_META[role].accent }} />
            <span>
              <span className="font-semibold uppercase tracking-wider text-ink-700">
                {ROLE_META[role].label}
              </span>
              <span className="text-ink-500"> &mdash; {description}</span>
            </span>
          </li>
        ))}
      </ul>

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
    return <p className="text-xs text-ink-400">Listing the seeded identities&hellip;</p>;
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
      <p className="border border-rule bg-canvas px-3 py-2.5 text-[11px] leading-relaxed text-ink-500">
        <span className="font-semibold text-ink-700">Local demo mode.</span> This build has no Supabase credentials, so
        the API is serving the seeded dataset and you can enter as any identity. Set{" "}
        <code className="font-mono">VITE_SUPABASE_URL</code> and <code className="font-mono">VITE_SUPABASE_ANON_KEY</code>{" "}
        to require a real password instead.
      </p>

      <div className="divide-y divide-rule-soft border border-rule">
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
                "flex w-full items-center gap-3 px-3 py-2.5 text-left transition hover:bg-accent-soft disabled:opacity-50",
              )}
            >
              <span className="h-6 w-1 shrink-0" style={{ background: meta.accent }} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-xs font-medium text-ink-900">{profile.fullName}</span>
                <span className="block truncate text-[10px] text-ink-400">{profile.email}</span>
              </span>
              <span
                className="shrink-0 text-[10px] font-semibold uppercase tracking-wider"
                style={{ color: meta.accent }}
              >
                {busy === profile.id ? "Opening" : meta.label}
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

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await signIn(email, password);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Sign-in failed.");
      setBusy(false);
    }
  }

  return (
    <form className="space-y-4" onSubmit={(event) => void handleSubmit(event)}>
      <Field label="Hospital email">
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
        {busy ? "Verifying" : "Sign in"}
      </Button>

      <details className="border border-rule bg-canvas px-3 py-2">
        <summary className="cursor-pointer text-[11px] font-medium text-ink-500">
          Evaluator accounts (seeded)
        </summary>
        <p className="mt-2 text-[10px] leading-relaxed text-ink-400">
          Every account below was created by <code className="font-mono">npm run seed</code> and shares the password{" "}
          <code className="font-mono text-ink-700">SmartMedic@2026</code>. Change or delete them before real use.
        </p>
        <table className="mt-2 w-full">
          <tbody>
            {SEEDED_ACCOUNTS.map((account) => (
              <tr key={account.email} className="border-b border-rule-soft last:border-0">
                <td className="py-1 pr-2 text-[10px] uppercase tracking-wider text-ink-500">{account.role}</td>
                <td className="py-1 text-[10px] text-ink-700">{account.email}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </form>
  );
}

export default function LoginPage() {
  const { mode, configured, status, error } = useSession();

  if (status === "loading") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-canvas text-xs text-ink-400">
        Checking the session&hellip;
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col bg-canvas">
      <div className="h-1 shrink-0 bg-accent" />
      <div className="flex flex-1 items-center justify-center px-4 py-8 lg:px-8">
        <div className="grid w-full max-w-5xl border border-rule bg-paper shadow-panel lg:grid-cols-[1.15fr_1fr]">
          <Letterhead />

          <div className="px-6 py-8 lg:px-10 lg:py-12">
            <p className="sm-eyebrow">Access control</p>
            <h2 className="mt-1 font-serif text-xl text-ink-900">Sign in</h2>
            <p className="mt-1.5 text-xs leading-relaxed text-ink-500">
              {configured
                ? "Use the account issued to you by the hospital."
                : "No Supabase project is configured for this build."}
            </p>

            <div className="mt-6">
              {configured ? <PasswordForm /> : <DemoIdentityPicker />}
            </div>

            {error ? (
              <p className="mt-4 border border-risk-critical/40 bg-risk-critical/[0.05] px-3 py-2 text-[11px] leading-relaxed text-risk-critical">
                {error}
              </p>
            ) : null}

            <p className="mt-6 border-t border-rule-soft pt-4 text-[10px] leading-relaxed text-ink-400">
              Session mode: <span className="font-medium text-ink-700">{mode}</span>.{" "}
              {configured
                ? "Passwords are verified by Supabase Auth; the API never sees them."
                : "No credentials are checked in demo mode."}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
