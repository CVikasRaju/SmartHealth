/**
 * Repository selection.
 *
 * The instance is cached for the lifetime of the server process. That matters
 * for the in-memory adapter, where the cache *is* the database: without it, a
 * local session would be reseeded on every request.
 */

import { createSeedDatabase } from "../../../src/data/mockData.js";
import type { ApiMode, ApiConfig } from "../config.js";
import { createMemoryRepository } from "./memory.js";
import { createSupabaseRepository } from "./supabase.js";
import type { Repository } from "./types.js";

let cached: { mode: ApiMode; repo: Repository } | null = null;

export function getRepository(config: ApiConfig): Repository {
  if (cached && cached.mode === config.mode) return cached.repo;

  // The mode is exhaustive: `readConfig` only reports `supabase` once every
  // credential is present, so there is no halfway state that could silently
  // serve seeded rows from a deployment configured for Postgres.
  const repo =
    config.mode === "supabase"
      ? createSupabaseRepository(config.supabaseUrl, config.supabaseServiceRoleKey)
      : createMemoryRepository(createSeedDatabase());

  cached = { mode: config.mode, repo };
  return repo;
}

/** Drop the cached instance. Used by tests and by the demo reset handler. */
export function resetRepositoryCache(): void {
  cached = null;
}

export { DuplicateIdError } from "./types.js";
export type { ProfileRecord, Repository } from "./types.js";
