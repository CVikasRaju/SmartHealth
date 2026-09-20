/**
 * Live verification.
 *
 * Drives the real deployment path end to end against the configured Supabase
 * project — the identity provider issues a token, the router verifies it, and the
 * profile it resolves decides the role:
 *
 *   npm run verify:live
 *
 * It needs credentials (`SUPABASE_URL`, `SUPABASE_ANON_KEY`,
 * `SUPABASE_SERVICE_ROLE_KEY`) and a seeded project, so unlike the other
 * verification scripts it is not part of `npm run verify`. What it catches is the
 * class of failure that only exists in production: an account advertised on the
 * sign-in screen that the identity provider does not know, a role that maps to
 * the wrong profile, or a patient scope that leaks another patient's record.
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { readConfig } from "../api/_lib/config";
import { buildApiRequest } from "../api/_lib/http";
import { routeRequest } from "../api/_lib/routes";
import { DEMO_PASSWORD, SEEDED_ACCOUNTS } from "../src/config/demoAccounts";

let failures = 0;
let checks = 0;

function assert(label: string, condition: boolean, detail = ""): void {
  checks += 1;
  if (condition) {
    console.log(`  ok   ${label}`);
    return;
  }
  failures += 1;
  console.log(`  FAIL ${label}${detail ? ` — ${detail}` : ""}`);
}

interface BootstrapData {
  profile?: { role?: string; patientId?: string | null; email?: string };
  db?: { patients?: { id?: string }[]; medicines?: unknown[] };
}

async function bootstrap(token: string) {
  const response = await routeRequest(
    buildApiRequest({
      method: "GET",
      url: "/api/bootstrap",
      headers: { authorization: `Bearer ${token}` },
    }),
  );
  const payload = response.payload as { success?: boolean; data?: BootstrapData; error?: { code?: string } };
  return { status: response.status, data: payload.data, error: payload.error };
}

function clientFor(url: string, anonKey: string): SupabaseClient {
  return createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
}

async function main(): Promise<void> {
  const config = readConfig();

  if (config.mode !== "supabase") {
    console.error(
      "\n  These checks need the Supabase credentials, and the API is not configured with them.\n" +
        "  Fill in .env (see .env.example) and run this again.\n",
    );
    process.exit(1);
  }

  console.log(`\nVerifying against ${config.supabaseUrl}\n`);

  /* ---------------- The identity provider ---------------- */

  const rejections = clientFor(config.supabaseUrl, config.supabaseAnonKey);
  const wrongPassword = await rejections.auth.signInWithPassword({
    email: SEEDED_ACCOUNTS[1].email,
    password: "definitely-not-the-password",
  });
  assert("a wrong password is refused by the identity provider", Boolean(wrongPassword.error));

  /* ---------------- Every advertised account ---------------- */

  for (const account of SEEDED_ACCOUNTS) {
    const client = clientFor(config.supabaseUrl, config.supabaseAnonKey);
    const { data, error } = await client.auth.signInWithPassword({
      email: account.email,
      password: DEMO_PASSWORD,
    });

    if (error || !data.session) {
      assert(`${account.email} signs in`, false, error?.message ?? "no session");
      continue;
    }
    assert(`${account.email} signs in`, true);

    const result = await bootstrap(data.session.access_token);
    assert(
      `${account.email} reaches the API with the role advertised on the sign-in screen (${account.role})`,
      result.status === 200 && result.data?.profile?.role === account.role,
      `status ${result.status}, role ${String(result.data?.profile?.role)}, ${JSON.stringify(result.error ?? null)}`,
    );

    if (account.role === "patient") {
      const visible = result.data?.db?.patients ?? [];
      assert(
        "a patient account sees exactly one record — its own",
        visible.length === 1 && visible[0]?.id === result.data?.profile?.patientId,
        `${visible.length} patient rows`,
      );
    } else if (account.role === "admin" || account.role === "doctor") {
      assert(
        `a ${account.role} account sees the whole register`,
        (result.data?.db?.patients?.length ?? 0) > 1,
        `${result.data?.db?.patients?.length ?? 0} patient rows`,
      );
    }

    assert(
      "the service role key never appears in a response",
      !JSON.stringify(result.data ?? {}).includes(config.supabaseServiceRoleKey),
    );

    await client.auth.signOut();
  }

  /* ---------------- Unauthenticated and forged callers ---------------- */

  const anonymous = await routeRequest(
    buildApiRequest({ method: "GET", url: "/api/bootstrap", headers: {} }),
  );
  assert("a request with no token is refused", anonymous.status === 401, `status ${anonymous.status}`);

  const forged = await routeRequest(
    buildApiRequest({
      method: "GET",
      url: "/api/bootstrap",
      headers: { authorization: "Bearer not-a-real-token" },
    }),
  );
  assert("a forged token is refused", forged.status === 401, `status ${forged.status}`);

  console.log(`\n${checks - failures} of ${checks} checks passed\n`);
  process.exit(failures === 0 ? 0 : 1);
}

void main();
