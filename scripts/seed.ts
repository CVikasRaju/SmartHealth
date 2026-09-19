/**
 * Database seed.
 *
 * Populates a Supabase project from the same dataset the offline prototype
 * ships with, so the deployed application and the local demo show identical
 * figures. Run it once after applying the migration:
 *
 *   npm run seed              # write to the project in .env
 *   npm run seed -- --dry-run # report what would happen, change nothing
 *
 * What it does:
 *   1. creates one Supabase auth user per seeded identity (staff and patients),
 *      with a confirmed email so no inbox is involved;
 *   2. upserts the matching `profiles` row, which is what carries the role;
 *   3. writes the whole clinical dataset through the same repository the API
 *      uses, so seeding cannot drift from runtime behaviour.
 *
 * Re-running is safe: rows are upserted, the demo password is reset, and
 * records created during a session are pruned.
 */

import { createClient } from "@supabase/supabase-js";

import { createSeedDatabase } from "../src/data/mockData";
import type { DatabaseState } from "../src/types";
import { createSupabaseRepository } from "../api/_lib/repo/supabase";

const DEMO_PASSWORD = process.env.SEED_DEMO_PASSWORD ?? "SmartMedic@2026";

const dryRun = process.argv.includes("--dry-run");

const supabaseUrl = (process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? "").trim();
const serviceRoleKey = (process.env.SUPABASE_SERVICE_ROLE_KEY ?? "").trim();

interface SeedIdentity {
  email: string;
  fullName: string;
  role: string;
  staffId: string | null;
  patientId: string | null;
}

function identities(db: DatabaseState): SeedIdentity[] {
  const staff: SeedIdentity[] = db.staff.map((member) => ({
    email: member.email,
    fullName: member.fullName,
    role: member.role,
    staffId: member.id,
    patientId: null,
  }));

  // Only patients with an email address get a portal account.
  const patients: SeedIdentity[] = db.patients
    .filter((patient) => patient.email.trim().length > 0)
    .map((patient) => ({
      email: patient.email,
      fullName: patient.name,
      role: "patient",
      staffId: null,
      patientId: patient.id,
    }));

  return [...staff, ...patients];
}

function describe(db: DatabaseState, identityList: SeedIdentity[]): void {
  console.log("  Dataset");
  console.log(`    staff             ${db.staff.length}`);
  console.log(`    patients          ${db.patients.length}`);
  console.log(`    medicines         ${db.medicines.length}`);
  console.log(`    appointments      ${db.appointments.length}`);
  console.log(`    treatments        ${db.treatments.length}`);
  console.log(`    administrations   ${db.administrations.length}`);
  console.log(`    invoices          ${db.invoices.length}`);
  console.log(`    reports           ${db.reports.length}`);
  console.log(`    login identities  ${identityList.length}`);
  console.log("");
}

async function main(): Promise<void> {
  const db = createSeedDatabase();
  const people = identities(db);

  if (dryRun) {
    console.log("\n  Dry run: nothing was written.\n");
    describe(db, people);
    for (const person of people) {
      console.log(`    ${person.role.padEnd(13)} ${person.fullName}  <${person.email}>`);
    }
    console.log("");
    return;
  }

  if (!supabaseUrl || !serviceRoleKey) {
    console.error(
      "\n  Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.\n" +
        "  Copy .env.example to .env and fill in your project values, then re-run.\n",
    );
    process.exitCode = 1;
    return;
  }

  const client = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  console.log(`\n  Seeding ${supabaseUrl}\n`);

  /* -------- 1. Dataset -------- */

  const repo = createSupabaseRepository(supabaseUrl, serviceRoleKey);
  await repo.reset(db);
  console.log("  Dataset written.");

  /* -------- 2. Auth users -------- */

  const { data: existing, error: listError } = await client.auth.admin.listUsers({
    page: 1,
    perPage: 1000,
  });

  if (listError) {
    // The most common cause is that the migration has not been applied yet.
    console.error(`\n  Could not read the auth users: ${listError.message}`);
    console.error("  Has supabase/migrations/0001_init.sql been applied to this project?\n");
    process.exitCode = 1;
    return;
  }

  const byEmail = new Map(existing.users.map((user) => [user.email ?? "", user.id]));

  for (const person of people) {
    const existingId = byEmail.get(person.email);

    if (existingId) {
      // Keep the credential known so the demo logins in the README still work.
      const { error } = await client.auth.admin.updateUserById(existingId, {
        password: DEMO_PASSWORD,
        email_confirm: true,
      });
      if (error) throw new Error(`Could not update ${person.email}: ${error.message}`);
    } else {
      const { data, error } = await client.auth.admin.createUser({
        email: person.email,
        password: DEMO_PASSWORD,
        email_confirm: true,
        user_metadata: { full_name: person.fullName, role: person.role },
      });
      if (error || !data.user) {
        throw new Error(`Could not create ${person.email}: ${error?.message ?? "unknown error"}`);
      }
      byEmail.set(person.email, data.user.id);
    }
  }
  console.log(`  Auth users provisioned: ${people.length}`);

  /* -------- 3. Profiles -------- */

  const profiles = people.map((person) => ({
    id: byEmail.get(person.email),
    email: person.email,
    full_name: person.fullName,
    role: person.role,
    staff_id: person.staffId,
    patient_id: person.patientId,
    is_active: true,
  }));

  const { error: profileError } = await client.from("profiles").upsert(profiles, { onConflict: "id" });
  if (profileError) {
    console.error(`\n  Could not write profiles: ${profileError.message}\n`);
    process.exitCode = 1;
    return;
  }
  console.log(`  Profiles linked: ${profiles.length}`);

  console.log("\n  Sign in at the app with any address below.\n");
  for (const person of people) {
    console.log(`    ${person.role.padEnd(13)} ${person.email}`);
  }
  console.log(`\n    password      ${DEMO_PASSWORD}\n`);
}

main().catch((error: unknown) => {
  console.error("\n  Seed failed:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
