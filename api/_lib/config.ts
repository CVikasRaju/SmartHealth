/**
 * Server configuration.
 *
 * The API runs in one of two modes:
 *
 *   `supabase` — the real deployment. Credentials come from the environment and
 *                every write lands in Postgres.
 *   `demo`     — a fallback that serves the API surface from the in-memory seed,
 *                so the whole stack can be exercised without a database.
 *
 * Demo mode is deliberately hard to reach: locally it is automatic (there is no
 * `.env`), but a deployment must opt in with `SMARTMEDIC_DEMO_MODE=1`. Without
 * that switch, a missing credential raises instead of quietly serving fabricated
 * rows through an API the browser treats as the hospital's database.
 */

export interface ApiConfigBase {
  isProduction: boolean;
}

/** Every credential is present: Postgres and Supabase Auth are in use. */
export interface SupabaseConfig extends ApiConfigBase {
  mode: "supabase";
  supabaseUrl: string;
  supabaseAnonKey: string;
  supabaseServiceRoleKey: string;
}

/** Credentials absent or deliberately bypassed: the seeded dataset is the store. */
export interface DemoConfig extends ApiConfigBase {
  mode: "demo";
  supabaseUrl: string | null;
  supabaseAnonKey: string | null;
  supabaseServiceRoleKey: string | null;
}

export type ApiConfig = SupabaseConfig | DemoConfig;
export type ApiMode = ApiConfig["mode"];

import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

function loadEnvFile(): void {
  try {
    const envPath = resolve(process.cwd(), ".env");
    if (existsSync(envPath)) {
      const content = readFileSync(envPath, "utf-8");
      for (const line of content.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) continue;
        const eqIdx = trimmed.indexOf("=");
        if (eqIdx !== -1) {
          const key = trimmed.slice(0, eqIdx).trim();
          const val = trimmed.slice(eqIdx + 1).trim().replace(/^['"](.*)['"]$/, "$1");
          if (key && !process.env[key]) {
            process.env[key] = val;
          }
        }
      }
    }
  } catch {
    // Ignore in restricted or production environments
  }
}

/** Treat empty strings from `.env` files as absent. */
function readEnv(...names: string[]): string | null {
  for (const name of names) {
    const value = process.env[name];
    if (typeof value === "string" && value.trim().length > 0) return value.trim();
  }
  return null;
}

export function isProductionRuntime(): boolean {
  return process.env.NODE_ENV === "production" || process.env.VERCEL_ENV === "production";
}

/**
 * Resolve the runtime configuration.
 *
 * Throws when a deployment is missing credentials and has not asked for demo
 * mode, which is what stops a half-configured production deploy from serving
 * seeded data as though it were the hospital's record. `routeRequest` turns the
 * throw into a 503 that names the missing variables.
 */
export function readConfig(): ApiConfig {
  loadEnvFile();
  const supabaseUrl = readEnv("SUPABASE_URL", "VITE_SUPABASE_URL");
  const supabaseAnonKey = readEnv("SUPABASE_ANON_KEY", "VITE_SUPABASE_ANON_KEY");
  const supabaseServiceRoleKey = readEnv("SUPABASE_SERVICE_ROLE_KEY");
  const isProduction = isProductionRuntime();

  if (supabaseUrl && supabaseAnonKey && supabaseServiceRoleKey) {
    return { mode: "supabase", supabaseUrl, supabaseAnonKey, supabaseServiceRoleKey, isProduction };
  }

  const missing = [
    supabaseUrl ? null : "SUPABASE_URL",
    supabaseAnonKey ? null : "SUPABASE_ANON_KEY",
    supabaseServiceRoleKey ? null : "SUPABASE_SERVICE_ROLE_KEY",
  ].filter((name): name is string => name !== null);

  if (!isProduction || readEnv("SMARTMEDIC_DEMO_MODE") === "1") {
    return { mode: "demo", supabaseUrl, supabaseAnonKey, supabaseServiceRoleKey, isProduction };
  }

  throw new Error(
    `The API is not configured. Missing ${missing.join(", ")}. ` +
      "Set these in the deployment's environment variables and redeploy, or set " +
      "SMARTMEDIC_DEMO_MODE=1 to serve the seeded demonstration dataset instead.",
  );
}
