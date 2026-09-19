/**
 * Repository selection.
 *
 * The instance is cached for the lifetime of the server process. That matters
 * for the in-memory adapter, where the cache *is* the database: without it, a
 * local session would be reseeded on every request.
 */

import { createSeedDatabase } from "../../../src/data/mockData";
import type { ApiMode, ApiConfig } from "../config";
import { createMemoryRepository } from "./memory";
import { createSupabaseRepository } from "./supabase";
import type { Repository } from "./types";

let cached: { mode: ApiMode; repo: Repository } | null = null;

export function getRepository(config: ApiConfig): Repository {
  if (cached && cached.mode === config.mode) return cached.repo;

  const repo =
    config.mode === "supabase" && config.supabaseUrl && config.supabaseServiceRoleKey
      ? createSupabaseRepository(config.supabaseUrl, config.supabaseServiceRoleKey)
      : createMemoryRepository(createSeedDatabase());

  cached = { mode: config.mode, repo };
  return repo;
}

/** Drop the cached instance. Used by tests and by the demo reset handler. */
export function resetRepositoryCache(): void {
  cached = null;
}

export { DuplicateIdError } from "./types";
export type { ProfileRecord, Repository } from "./types";
