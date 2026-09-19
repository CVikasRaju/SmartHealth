/**
 * Repository contract.
 *
 * Both persistence adapters — Postgres via Supabase, and the in-memory seed used
 * for local development — implement this interface, so the service layer that
 * holds the clinical and financial rules never knows which one it is talking to.
 */

import type { DatabaseState, Role } from "../../../src/types";
import type { CollectionName } from "../registry";

/** Authorisation profile for one authenticated user. */
export interface ProfileRecord {
  id: string;
  email: string;
  fullName: string;
  role: Role;
  staffId: string | null;
  patientId: string | null;
  isActive: boolean;
  lastLogin: string | null;
}

/**
 * Raised when an insert collides with an existing primary key. The client
 * generates identifiers optimistically, so a collision means its snapshot is
 * stale; the router turns this into a 409 that makes the client re-bootstrap.
 */
export class DuplicateIdError extends Error {
  constructor(
    readonly collection: CollectionName,
    readonly id: string,
  ) {
    super(`A ${collection} row with id ${id} already exists`);
    this.name = "DuplicateIdError";
  }
}

export interface Repository {
  readonly kind: "supabase" | "memory";

  /** Read the entire dataset in the shape the client store expects. */
  loadState(): Promise<DatabaseState>;

  /** Insert one domain object, decomposing child rows into their own tables. */
  insert(collection: CollectionName, row: Record<string, unknown>): Promise<void>;

  /** Apply a partial update, replacing any child collection named in the patch. */
  update(collection: CollectionName, id: string, patch: Record<string, unknown>): Promise<void>;

  /** Advance the human-readable ID sequences and return the new values. */
  bumpCounters(deltas: Record<string, number>): Promise<Record<string, number>>;

  /** Replace seeded data, keeping staff and patients that other rows reference. */
  reset(db: DatabaseState): Promise<void>;

  listProfiles(): Promise<ProfileRecord[]>;
  findProfileByAuthId(authUserId: string): Promise<ProfileRecord | null>;
  markLogin(profileId: string): Promise<void>;
}
