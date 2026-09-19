/**
 * In-memory repository.
 *
 * Serves the identical API surface as the Postgres adapter using the seeded
 * dataset. It exists so the stack can be run and tested end to end with no
 * Supabase project, and so a reviewer can evaluate the prototype offline. The
 * API refuses to select this adapter in production unless it is asked for
 * explicitly.
 */

import { createSeedDatabase } from "../../../src/data/mockData";
import type { DatabaseState, Role, StaffMember } from "../../../src/types";
import { DuplicateIdError, type ProfileRecord, type Repository } from "./types";
import type { CollectionName } from "../registry";

function clone<T>(value: T): T {
  return structuredClone(value);
}

/**
 * Synthesise an authorisation profile per seeded identity. In demo mode these
 * stand in for Supabase auth users, and the login screen offers them directly.
 */
function deriveProfiles(db: DatabaseState): ProfileRecord[] {
  const staff: ProfileRecord[] = db.staff.map((member: StaffMember) => ({
    id: `demo-${member.id}`,
    email: member.email,
    fullName: member.fullName,
    role: member.role as Role,
    staffId: member.id,
    patientId: null,
    isActive: true,
    lastLogin: null,
  }));

  const patients: ProfileRecord[] = db.patients.map((patient) => ({
    id: `demo-${patient.id}`,
    email: patient.email,
    fullName: patient.name,
    role: "patient" as Role,
    staffId: null,
    patientId: patient.id,
    isActive: true,
    lastLogin: null,
  }));

  const superadmin: ProfileRecord = {
    id: "demo-superadmin-1",
    email: "superadmin@smartmedic.io",
    fullName: "Dr. Rajeshwar Hegde",
    role: "superadmin",
    staffId: null,
    patientId: null,
    isActive: true,
    lastLogin: null,
  };

  return [superadmin, ...staff, ...patients];
}

export function createMemoryRepository(seed?: DatabaseState): Repository {
  let db: DatabaseState = clone(seed ?? createSeedDatabase());
  let profiles: ProfileRecord[] = deriveProfiles(db);

  return {
    kind: "memory",

    async loadState() {
      return clone(db);
    },

    async insert(collection: CollectionName, row: Record<string, unknown>) {
      const target = db[collection] as unknown as Record<string, unknown>[];
      const id = String(row.id);
      if (target.some((existing) => String(existing.id) === id)) {
        throw new DuplicateIdError(collection, id);
      }
      target.push(clone(row));
    },

    async update(collection: CollectionName, id: string, patch: Record<string, unknown>) {
      const target = db[collection] as unknown as Record<string, unknown>[];
      const existing = target.find((row) => String(row.id) === id);
      if (!existing) return;
      for (const [key, value] of Object.entries(patch)) {
        if (value !== undefined) existing[key] = clone(value);
      }
    },

    async bumpCounters(deltas: Record<string, number>) {
      for (const [key, delta] of Object.entries(deltas)) {
        db.counters[key] = (db.counters[key] ?? 0) + delta;
      }
      return clone(db.counters);
    },

    async reset(next: DatabaseState) {
      db = clone(next);
      profiles = deriveProfiles(db);
    },

    async listProfiles() {
      return clone(profiles);
    },

    async findProfileByAuthId(authUserId: string) {
      const found = profiles.find((profile) => profile.id === authUserId);
      return found ? clone(found) : null;
    },

    async markLogin(profileId: string) {
      profiles = profiles.map((profile) =>
        profile.id === profileId ? { ...profile, lastLogin: new Date().toISOString() } : profile,
      );
    },
  };
}
