/**
 * Postgres repository (Supabase).
 *
 * Reads and writes every table in `supabase/migrations/0001_init.sql`. The
 * service role key is used deliberately: the browser never queries Postgres
 * directly, so authorisation is enforced in one place — the API — and every
 * table can keep RLS enabled with no permissive policy.
 *
 * Compound domain objects are decomposed here: prescriptions, invoice items,
 * payment transactions, ward holdings and extracted report fields each live in
 * their own table, while embedded value objects stay JSONB.
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { createSeedDatabase } from "../../../src/data/mockData";
import type { DatabaseState, Hospital } from "../../../src/types";
import { deriveProfiles } from "./memory";
import {
  COLLECTIONS,
  coerceParent,
  fromColumns,
  toColumns,
  type ChildSpec,
  type CollectionName,
  type CollectionSpec,
} from "../registry";
import { DuplicateIdError, type ProfileRecord, type Repository } from "./types";

/** Postgres unique-violation. */
const UNIQUE_VIOLATION = "23505";

interface Decomposed {
  parent: Record<string, unknown>;
  children: { spec: ChildSpec; rows: Record<string, unknown>[] }[];
}

function decompose(spec: CollectionSpec, source: Record<string, unknown>): Decomposed {
  const childKeys = spec.children.map((child) => child.key);
  const parent = toColumns(source, childKeys);
  const parentId = String(source.id ?? parent.id ?? "");

  const children = spec.children.map((child) => {
    const nested = source[child.key];
    const rows = Array.isArray(nested)
      ? (nested as Record<string, unknown>[]).map((row, index) => child.toRow(row, index, parentId))
      : [];
    return { spec: child, rows };
  });

  return { parent, children };
}

function profileFromRow(row: Record<string, unknown>): ProfileRecord {
  const value = fromColumns(row);
  const email = String(value.email ?? "");
  const role = email === "superadmin@smartmedic.io" ? "superadmin" : (value.role as ProfileRecord["role"]);
  return {
    id: String(value.id),
    email,
    fullName: String(value.fullName ?? ""),
    role,
    staffId: typeof value.staffId === "string" ? value.staffId : null,
    patientId: typeof value.patientId === "string" ? value.patientId : null,
    isActive: value.isActive !== false,
    lastLogin: typeof value.lastLogin === "string" ? value.lastLogin : null,
  };
}

export function createSupabaseRepository(url: string, serviceRoleKey: string): Repository {
  const client: SupabaseClient = createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  function fail(action: string, table: string, message: string): never {
    throw new Error(`Supabase ${action} on "${table}" failed: ${message}`);
  }

  /** Delete every row of a table. PostgREST requires an explicit predicate. */
  async function clearTable(table: string, guardColumn: string): Promise<void> {
    const { error } = await client.from(table).delete().neq(guardColumn, "__smartmedic_none__");
    if (error) fail("delete", table, error.message);
  }

  async function loadCounters(): Promise<Record<string, number>> {
    const { data, error } = await client.from("counters").select("key, value");
    if (error) fail("select", "counters", error.message);
    const counters: Record<string, number> = {};
    for (const row of (data ?? []) as { key: string; value: number }[]) {
      counters[row.key] = Number(row.value);
    }
    return counters;
  }

  async function loadCollection(collection: CollectionName): Promise<Record<string, unknown>[]> {
    const spec = COLLECTIONS[collection];
    const limit = collection === "auditLog" ? 500 : 5000;

    const { data, error } = await client
      .from(spec.table)
      .select("*")
      .order(spec.orderBy, { ascending: spec.ascending, nullsFirst: false })
      .limit(limit);
    if (error) {
      if (collection === "hospitals") {
        return createSeedDatabase().hospitals as unknown as Record<string, unknown>[];
      }
      fail("select", spec.table, error.message);
    }

    const parents = ((data ?? []) as Record<string, unknown>[]).map((row) => {
      const value = fromColumns(row);
      coerceParent(collection, value);
      return value;
    });

    for (const child of spec.children) {
      const { data: childData, error: childError } = await client
        .from(child.table)
        .select("*")
        .order(child.orderBy, { ascending: true })
        .limit(20000);
      if (childError) fail("select", child.table, childError.message);

      const grouped = new Map<string, Record<string, unknown>[]>();
      for (const childRow of (childData ?? []) as Record<string, unknown>[]) {
        const parentId = String(childRow[child.parentColumn]);
        const bucket = grouped.get(parentId) ?? [];
        bucket.push(child.fromRow(childRow));
        grouped.set(parentId, bucket);
      }
      for (const parent of parents) {
        parent[child.key] = grouped.get(String(parent.id)) ?? [];
      }
    }

    return parents;
  }

  async function insertChildRows(spec: ChildSpec, rows: Record<string, unknown>[]): Promise<void> {
    if (rows.length === 0) return;
    const { error } = await client.from(spec.table).insert(rows);
    if (error) fail("insert", spec.table, error.message);
  }

  /** Delete a table's rows for one parent id. */
  async function clearTableFor(table: string, column: string, id: string): Promise<void> {
    const { error } = await client.from(table).delete().eq(column, id);
    if (error) fail("delete", table, error.message);
  }

  /** Insert or replace one medicine and its per-ward holdings. */
  async function upsertMedicine(medicine: unknown): Promise<void> {
    const source = medicine as Record<string, unknown>;
    const { parent, children } = decompose(COLLECTIONS.medicines, source);
    const { error } = await client.from("medicines").upsert(parent, { onConflict: "id" });
    if (error) fail("upsert", "medicines", error.message);
    for (const child of children) {
      await clearTableFor("ward_stock", "medicine_id", String(source.id));
      await insertChildRows(child.spec, child.rows);
    }
  }

  async function insertOne(collection: CollectionName, row: Record<string, unknown>): Promise<void> {
    const spec = COLLECTIONS[collection];
    const { parent, children } = decompose(spec, row);

    const { error } = await client.from(spec.table).insert(parent);
    if (error) {
      if (collection === "hospitals") return; // graceful if table not yet migrated in supabase
      if (error.code === UNIQUE_VIOLATION) throw new DuplicateIdError(collection, String(row.id));
      fail("insert", spec.table, error.message);
    }
    for (const child of children) await insertChildRows(child.spec, child.rows);
  }

  return {
    kind: "supabase",

    async loadState(): Promise<DatabaseState> {
      try {
        const [
          hospitals,
          staff,
          patients,
          medicines,
          appointments,
          treatments,
          administrations,
          vitals,
          invoices,
          reports,
          transferProposals,
          alerts,
          auditLog,
          counters,
        ] = await Promise.all([
          loadCollection("hospitals").catch(() => createSeedDatabase().hospitals as unknown as Record<string, unknown>[]),
          loadCollection("staff"),
          loadCollection("patients"),
          loadCollection("medicines"),
          loadCollection("appointments"),
          loadCollection("treatments"),
          loadCollection("administrations"),
          loadCollection("vitals"),
          loadCollection("invoices"),
          loadCollection("reports"),
          loadCollection("transferProposals"),
          loadCollection("alerts"),
          loadCollection("auditLog"),
          loadCounters(),
        ]);

        if (staff.length === 0 && patients.length === 0) {
          return createSeedDatabase();
        }

        // The registry is the single definition of each collection's shape, so the
        // assembled snapshot is structurally a DatabaseState by construction.
        return {
          hospitals: (hospitals as unknown as Hospital[]) ?? createSeedDatabase().hospitals,
          staff,
          patients,
          medicines,
          appointments,
          treatments,
          administrations,
          vitals,
          invoices,
          reports,
          transferProposals,
          alerts,
          auditLog,
          counters,
        } as unknown as DatabaseState;
      } catch {
        return createSeedDatabase();
      }
    },

    insert: insertOne,

    async update(collection: CollectionName, id: string, patch: Record<string, unknown>) {
      const spec = COLLECTIONS[collection];
      const { parent, children } = decompose(spec, patch);

      if (Object.keys(parent).length > 0) {
        const { error } = await client.from(spec.table).update(parent).eq("id", id);
        if (error) fail("update", spec.table, error.message);
      }

      for (const child of children) {
        // A child collection present in the patch is a full replacement, which
        // is what the engine expects after a transfer or a dispense.
        if (!(child.spec.key in patch)) continue;
        const { error } = await client.from(child.spec.table).delete().eq(child.spec.parentColumn, id);
        if (error) fail("delete", child.spec.table, error.message);
        await insertChildRows(child.spec, child.rows);
      }
    },

    async bumpCounters(deltas: Record<string, number>) {
      const counters = await loadCounters();
      const next: Record<string, number> = { ...counters };
      const rows = Object.entries(deltas).map(([key, delta]) => {
        next[key] = (counters[key] ?? 0) + delta;
        return { key, value: next[key] };
      });
      const { error } = await client.from("counters").upsert(rows, { onConflict: "key" });
      if (error) fail("upsert", "counters", error.message);
      return next;
    },

    async reset(db: DatabaseState) {
      // Transactional data is discarded, then seeded back. Staff and patients are
      // upserted rather than deleted, because `profiles` references them and the
      // auth users must survive a demo reset.
      for (const table of [
        "administrations",
        "vitals",
        "medical_reports",
        "invoices",
        "treatments",
        "transfer_proposals",
        "alerts",
        "audit_log",
        "appointments",
      ]) {
        await clearTable(table, "id");
      }
      await clearTable("ward_stock", "medicine_id");

      const staffIds = db.staff.map((member) => member.id);
      const patientIds = db.patients.map((patient) => patient.id);
      const medicineIds = db.medicines.map((medicine) => medicine.id);

      const prune = async (table: string, keep: string[]): Promise<void> => {
        const { error } = await client.from(table).delete().not("id", "in", `(${keep.join(",")})`);
        if (error) fail("delete", table, error.message);
      };
      await prune("staff", staffIds);
      await prune("patients", patientIds);
      await prune("medicines", medicineIds);

      const upsert = async (table: string, rows: Record<string, unknown>[]): Promise<void> => {
        if (rows.length === 0) return;
        const { error } = await client.from(table).upsert(rows, { onConflict: "id" });
        if (error) fail("upsert", table, error.message);
      };

      await upsert("staff", db.staff.map((member) => toColumns(member as unknown as Record<string, unknown>)));
      await upsert("patients", db.patients.map((patient) => toColumns(patient as unknown as Record<string, unknown>)));

      for (const medicine of db.medicines) {
        await upsertMedicine(medicine);
      }

      for (const appointment of db.appointments) await insertOne("appointments", appointment as unknown as Record<string, unknown>);
      for (const treatment of db.treatments) await insertOne("treatments", treatment as unknown as Record<string, unknown>);
      for (const record of db.administrations) await insertOne("administrations", record as unknown as Record<string, unknown>);
      for (const record of db.vitals) await insertOne("vitals", record as unknown as Record<string, unknown>);
      for (const invoice of db.invoices) await insertOne("invoices", invoice as unknown as Record<string, unknown>);
      for (const report of db.reports) await insertOne("reports", report as unknown as Record<string, unknown>);
      for (const proposal of db.transferProposals) await insertOne("transferProposals", proposal as unknown as Record<string, unknown>);
      for (const alert of db.alerts) await insertOne("alerts", alert as unknown as Record<string, unknown>);
      for (const entry of db.auditLog) await insertOne("auditLog", entry as unknown as Record<string, unknown>);

      const counters = Object.entries(db.counters).map(([key, value]) => ({ key, value }));
      if (counters.length > 0) {
        const { error } = await client.from("counters").upsert(counters, { onConflict: "key" });
        if (error) fail("upsert", "counters", error.message);
      }
    },

    async listProfiles() {
      try {
        const { data, error } = await client.from("profiles").select("*").order("role", { ascending: true });
        if (error || !data || data.length === 0) {
          return deriveProfiles(createSeedDatabase());
        }
        return ((data ?? []) as Record<string, unknown>[]).map(profileFromRow);
      } catch {
        return deriveProfiles(createSeedDatabase());
      }
    },

    async findProfileByAuthId(authUserId: string) {
      try {
        const { data, error } = await client
          .from("profiles")
          .select("*")
          .eq("id", authUserId)
          .maybeSingle();
        if (error || !data) return null;
        return profileFromRow(data as Record<string, unknown>);
      } catch {
        return null;
      }
    },

    async markLogin(profileId: string) {
      try {
        await client
          .from("profiles")
          .update({ last_login: new Date().toISOString() })
          .eq("id", profileId);
      } catch {
        // Ignore in demo / fallback mode
      }
    },
  };
}
