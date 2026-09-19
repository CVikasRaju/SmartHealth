/**
 * Apply the SQL migration to the Supabase Postgres instance directly.
 *
 *   node scripts/apply-schema.mjs
 *
 * Reads DATABASE_URL from .env (via dotenv-style parsing done inline, so no
 * extra dependency) and executes supabase/migrations/0001_init.sql as one
 * batch. Idempotent: every statement in the migration is IF NOT EXISTS / OR
 * REPLACE, so re-running is safe.
 */

import fs from "node:fs";
import path from "node:path";
import pg from "pg";

// --- Minimal .env loader (no dependency) -----------------------------------
const envPath = path.resolve(".env");
if (!fs.existsSync(envPath)) {
  console.error("\n  No .env found. Copy .env.example to .env and fill in the values.\n");
  process.exit(1);
}
for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
  const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
  if (match && process.env[match[1]] === undefined) {
    process.env[match[1]] = match[2];
  }
}

const databaseUrl = (process.env.DATABASE_URL ?? "").trim();
if (!databaseUrl) {
  console.error("\n  DATABASE_URL is not set in .env — it is needed once to apply the schema.\n");
  process.exit(1);
}

const migrationPath = path.resolve("supabase/migrations/0001_init.sql");
const sql = fs.readFileSync(migrationPath, "utf8");

console.log(`\n  Applying ${path.basename(migrationPath)} ...`);

const client = new pg.Client({
  connectionString: databaseUrl,
  ssl: { rejectUnauthorized: false },
});

await client.connect();

try {
  await client.query("begin");
  await client.query(sql);
  await client.query("commit");
  console.log("  Schema applied and committed.");
} catch (error) {
  await client.query("rollback");
  console.error("\n  Migration failed, rolled back:", error.message, "\n");
  process.exitCode = 1;
} finally {
  await client.end();
}

// --- Post-check: confirm the core tables exist -----------------------------
const verify = new pg.Client({ connectionString: databaseUrl, ssl: { rejectUnauthorized: false } });
await verify.connect();
const { rows } = await verify.query(
  "select table_name from information_schema.tables where table_schema = 'public' order by table_name",
);
await verify.end();

const expected = ["staff", "patients", "medicines", "appointments", "treatments", "invoices", "reports", "profiles"];
const missing = expected.filter((table) => !rows.some((row) => row.table_name === table));

if (missing.length > 0) {
  console.error(`  WARNING: expected tables missing: ${missing.join(", ")}\n`);
  process.exitCode = 1;
} else {
  console.log(`  Verified: ${rows.length} tables present in public schema, all core tables found.\n`);
}
