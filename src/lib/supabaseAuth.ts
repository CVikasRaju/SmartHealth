/**
 * Supabase authentication client.
 *
 * Only the authentication half of Supabase is used from the browser: the access
 * token it issues is sent to the SmartMedic API, which is what actually reads
 * and writes the database. The anon key is public by design and grants nothing
 * on its own, because every table has row level security enabled.
 *
 * When the two build-time variables are absent the application runs in demo
 * mode against the seeded dataset, which is how the offline prototype and the
 * local development workflow keep working.
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export interface ClientAuthConfig {
  url: string;
  anonKey: string;
}

function read(key: "VITE_SUPABASE_URL" | "VITE_SUPABASE_ANON_KEY"): string | null {
  const value = import.meta.env[key];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

/** Build-time configuration, or null when the app should run in demo mode. */
export function readClientAuthConfig(): ClientAuthConfig | null {
  const url = read("VITE_SUPABASE_URL");
  const anonKey = read("VITE_SUPABASE_ANON_KEY");
  return url && anonKey ? { url, anonKey } : null;
}

export function createAuthClient(config: ClientAuthConfig): SupabaseClient {
  return createClient(config.url, config.anonKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      storageKey: "smartmedic.auth.v1",
    },
  });
}
