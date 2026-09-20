/**
 * Authentication.
 *
 * In Supabase mode the caller presents the access token issued by
 * `supabase.auth.signInWithPassword` in the browser. The token is verified
 * against the Auth server — not merely decoded — and then mapped to a hospital
 * profile, which is what carries the role. A valid Supabase user with no profile
 * row is rejected: holding a credential is not the same as holding a role.
 *
 * In demo mode there are no credentials. The caller names the seeded identity it
 * wishes to act as via the `x-smartmedic-actor` header, defaulting to the
 * hospital administrator. This is only reachable when the API itself is serving
 * the seeded dataset, which `readConfig` refuses on a deployment unless it was
 * explicitly opted in.
 *
 * The rule that matters: a request that fails authentication is *rejected*. It is
 * never downgraded to a seeded identity, because doing so would hand an
 * anonymous caller an administrator's data.
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import type { ApiConfig, SupabaseConfig } from "./config.js";
import { HttpError, type ApiRequest } from "./http.js";
import type { ProfileRecord, Repository } from "./repo/types.js";

export const DEMO_ACTOR_HEADER = "x-smartmedic-actor";

/**
 * Identity attached to endpoints that answer before authentication.
 *
 * Those endpoints take no action on the hospital record, so they need no role;
 * giving them the least privileged one means an accidental `requireRole` call in
 * a public handler fails closed rather than open.
 */
export const ANONYMOUS_ACTOR: ProfileRecord = {
  id: "anonymous",
  email: "",
  fullName: "Anonymous request",
  role: "patient",
  staffId: null,
  patientId: null,
  isActive: false,
  lastLogin: null,
};

let cachedAuthClient: SupabaseClient | null = null;

/** Client bound to the public `anon` key: it can verify tokens, and nothing more. */
function anonClient(config: SupabaseConfig): SupabaseClient {
  cachedAuthClient ??= createClient(config.supabaseUrl, config.supabaseAnonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return cachedAuthClient;
}

/** Verify a bearer token with Supabase and return the auth user info. */
async function verifyToken(config: SupabaseConfig, token: string): Promise<{ id: string; email?: string }> {
  const { data, error } = await anonClient(config).auth.getUser(token);
  if (error || !data.user) {
    throw new HttpError(401, "invalid_token", "The session token is missing, expired, or invalid.");
  }
  return { id: data.user.id, email: data.user.email };
}

/**
 * Resolve the acting profile for a request, or reject it.
 *
 * Used by every route that touches hospital data.
 */
export async function resolveActor(
  req: ApiRequest,
  config: ApiConfig,
  repo: Repository,
): Promise<ProfileRecord> {
  if (config.mode === "demo") return resolveDemoActor(req, repo);

  if (!req.token) {
    throw new HttpError(401, "missing_token", "This request did not present an access token.");
  }

  return resolveAuthenticatedActor(req.token, config, repo);
}

/**
 * Resolve the acting profile for a public endpoint, without rejecting.
 *
 * `/api/health` is how a client discovers which mode the API is in, so it has to
 * answer before anybody has a token. A token that is present but unreadable is
 * reported as no identity rather than as a failure.
 */
export async function resolveOptionalActor(
  req: ApiRequest,
  config: ApiConfig,
  repo: Repository,
): Promise<ProfileRecord> {
  if (config.mode === "demo") return resolveDemoActor(req, repo);
  if (!req.token) return ANONYMOUS_ACTOR;

  try {
    return await resolveAuthenticatedActor(req.token, config, repo);
  } catch {
    return ANONYMOUS_ACTOR;
  }
}

/** Verify the token, then map it onto the profile that carries the role. */
async function resolveAuthenticatedActor(
  token: string,
  config: SupabaseConfig,
  repo: Repository,
): Promise<ProfileRecord> {
  const authUser = await verifyToken(config, token);

  const byAuthId = await repo.findProfileByAuthId(authUser.id);
  const profile = byAuthId ?? (authUser.email ? await findProfileByEmail(repo, authUser.email) : null);

  if (!profile) {
    throw new HttpError(
      403,
      "no_profile",
      "This account is authenticated but has no SmartMedic profile, so it holds no role. " +
        "Run `npm run seed` to provision the demonstration identities.",
    );
  }
  if (!profile.isActive) {
    throw new HttpError(403, "account_disabled", "This account has been deactivated.");
  }
  return profile;
}

/**
 * Match a Supabase user to a profile row by email.
 *
 * A repair path for accounts whose profile is keyed to an older auth id; the
 * database is authoritative, so no seeded or hard-coded roster is consulted.
 */
async function findProfileByEmail(repo: Repository, email: string): Promise<ProfileRecord | null> {
  const needle = email.trim().toLowerCase();
  if (!needle) return null;
  const profiles = await repo.listProfiles();
  return profiles.find((profile) => profile.email.trim().toLowerCase() === needle) ?? null;
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
