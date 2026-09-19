/**
 * Authentication.
 *
 * In Supabase mode the caller presents the access token issued by
 * `supabase.auth.signInWithPassword`; the token is verified against the Auth
 * server (not merely decoded) and then mapped to a hospital profile, which is
 * what carries the role. A valid Supabase user with no profile row is rejected:
 * holding a credential is not the same as holding a role.
 *
 * In demo mode there are no credentials. The caller names the seeded identity it
 * wishes to act as via the `x-smartmedic-actor` header, defaulting to the
 * hospital administrator. This path is unreachable in production.
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import type { ApiConfig } from "./config";
import { HttpError, type ApiRequest } from "./http";
import type { ProfileRecord, Repository } from "./repo/types";

export const DEMO_ACTOR_HEADER = "x-smartmedic-actor";

let cachedAuthClient: SupabaseClient | null = null;

function authClient(config: ApiConfig): SupabaseClient {
  if (!config.supabaseUrl || !config.supabaseAnonKey) {
    throw new HttpError(503, "not_configured", "Supabase credentials are missing from the environment.");
  }
  cachedAuthClient ??= createClient(config.supabaseUrl, config.supabaseAnonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return cachedAuthClient;
}

/** Verify a bearer token with Supabase and return the auth user id. */
async function verifyToken(config: ApiConfig, token: string): Promise<string> {
  const { data, error } = await authClient(config).auth.getUser(token);
  if (error || !data.user) {
    throw new HttpError(401, "invalid_token", "The session token is missing, expired, or invalid.");
  }
  return data.user.id;
}

/**
 * Resolve the acting profile for a request, or throw the appropriate 401/403.
 */
export async function resolveActor(
  req: ApiRequest,
  config: ApiConfig,
  repo: Repository,
): Promise<ProfileRecord> {
  if (config.mode === "demo") {
    return resolveDemoActor(req, repo);
  }

  if (!req.token) {
    throw new HttpError(401, "missing_token", "Authorization: Bearer <access token> is required.");
  }

  const authUserId = await verifyToken(config, req.token);
  const profile = await repo.findProfileByAuthId(authUserId);

  if (!profile) {
    throw new HttpError(
      403,
      "no_profile",
      "This account is not linked to a hospital profile. Run `npm run seed` to provision the demo identities.",
    );
  }
  if (!profile.isActive) {
    throw new HttpError(403, "inactive_profile", "This account has been deactivated.");
  }
  return profile;
}

async function resolveDemoActor(req: ApiRequest, repo: Repository): Promise<ProfileRecord> {
  const requested = req.headers[DEMO_ACTOR_HEADER];
  const profiles = await repo.listProfiles();

  if (requested) {
    const match = profiles.find((profile) => profile.id === requested);
    if (!match) throw new HttpError(404, "unknown_actor", `No demo profile with id "${requested}".`);
    return match;
  }

  const administrator = profiles.find((profile) => profile.role === "admin");
  if (!administrator) {
    throw new HttpError(503, "not_configured", "The demo dataset has no administrator profile.");
  }
  return administrator;
}
