/**
 * Server configuration.
 *
 * The API runs in one of two modes:
 *
 *   `supabase` — the real deployment. Credentials come from the environment and
 *                every write lands in Postgres.
 *   `demo`     — a local-only fallback that serves the same API surface from the
 *                in-memory seed, so the whole stack can be exercised without a
 *                database. It is refused outright in production, so a missing
 *                environment variable can never leave a deployed API serving
 *                unauthenticated hospital data.
 */

export type ApiMode = "supabase" | "demo";

export interface ApiConfig {
  mode: ApiMode;
  supabaseUrl: string | null;
  supabaseAnonKey: string | null;
  supabaseServiceRoleKey: string | null;
  isProduction: boolean;
}

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
 * Throws when the deployment is missing credentials and demo mode has not been
 * explicitly requested, which is what stops a half-configured production
 * deploy from silently falling back to seeded data.
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

  const demoRequested = readEnv("SMARTMEDIC_DEMO_MODE") === "1";
  if (isProduction && !demoRequested) {
    const missing = [
      supabaseUrl ? null : "SUPABASE_URL",
      supabaseAnonKey ? null : "SUPABASE_ANON_KEY",
      supabaseServiceRoleKey ? null : "SUPABASE_SERVICE_ROLE_KEY",
    ].filter((name): name is string => name !== null);

    throw new Error(
      `SmartMedic API is not configured. Missing environment variable(s): ${missing.join(", ")}. ` +
        "Set them in the Vercel project settings, or set SMARTMEDIC_DEMO_MODE=1 to serve seeded " +
        "data without a database (not recommended for a public deployment).",
    );
  }

  return { mode: "demo", supabaseUrl, supabaseAnonKey, supabaseServiceRoleKey, isProduction };
}
