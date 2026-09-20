/**
 * Deployment verification.
 *
 * Reproduces what Vercel's Node builder does to `api/[...path].ts` and then
 * exercises the result, so a wiring mistake is caught here instead of on the
 * deployed site.
 *
 * Vercel compiles the function with the project's own TypeScript configuration,
 * overriding it only to emit (`noEmit: false`). That is what turns `.js`-suffixed
 * relative imports into resolvable paths under Node's ESM loader — and it is the
 * failure this guards against, because it is invisible in Vite: an extensionless
 * specifier typechecks and bundles happily, then throws `ERR_MODULE_NOT_FOUND`
 * inside the deployed function, and every `/api` call fails.
 *
 * Checks performed against the emitted handler, booted over real HTTP:
 *   1. every module in the function graph resolved as an ES module;
 *   2. with no credentials the API serves the seeded dataset;
 *   3. on a credentialed deployment, a request without a valid token is
 *      rejected rather than handed the administrator's identity.
 *
 *   node scripts/verify-deploy.mjs
 */

import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const scratch = join(root, ".tmp");
const workDir = join(scratch, "vercel-emit");
const tsconfigPath = join(scratch, "tsconfig.vercel.json");
const entrySource = join(root, "api", "[...path].ts");

let failures = 0;
let checks = 0;

function assert(label, condition, detail) {
  checks += 1;
  if (condition) {
    console.log(`  ok   ${label}`);
    return;
  }
  failures += 1;
  console.log(`  FAIL ${label}${detail === undefined ? "" : ` — ${detail}`}`);
}

function clearCredentials() {
  for (const key of [
    "SUPABASE_URL",
    "SUPABASE_ANON_KEY",
    "SUPABASE_SERVICE_ROLE_KEY",
    "VITE_SUPABASE_URL",
    "VITE_SUPABASE_ANON_KEY",
    "SMARTMEDIC_DEMO_MODE",
  ]) {
    delete process.env[key];
  }
}

/* ------------------------------------------------------------------ */
/* 1. Emit the function the way Vercel's builder does                  */
/* ------------------------------------------------------------------ */

console.log("\nEmulating the Vercel Node builder\n");

rmSync(workDir, { recursive: true, force: true });
// An empty working directory, so the `loadEnvFile()` fallback cannot reach this
// repository's own `.env` and leak real credentials into either pass.
const isolatedCwd = join(scratch, "no-env-here");
rmSync(isolatedCwd, { recursive: true, force: true });
mkdirSync(isolatedCwd, { recursive: true });

writeFileSync(
  tsconfigPath,
  JSON.stringify(
    {
      extends: join(root, "tsconfig.json"),
      compilerOptions: {
        sourceMap: true,
        inlineSourceMap: false,
        inlineSources: true,
        declaration: false,
        declarationMap: false,
        emitDeclarationOnly: false,
        noEmit: false,
        outDir: workDir,
        rootDir: root,
        incremental: false,
        composite: false,
        rewriteRelativeImportExtensions: true,
      },
      files: [entrySource],
      include: [],
      exclude: [],
    },
    null,
    2,
  ),
);

try {
  execFileSync(
    process.execPath,
    [join(root, "node_modules", "typescript", "bin", "tsc"), "--project", tsconfigPath],
    { cwd: root, stdio: "pipe", encoding: "utf8" },
  );
  assert("the function compiles with the project's TypeScript configuration", true);
} catch (error) {
  assert(
    "the function compiles with the project's TypeScript configuration",
    false,
    String(error.stdout || error.stderr || error.message).split("\n")[0],
  );
}

let handler = null;
try {
  handler = (await import(pathToFileURL(join(workDir, "api", "[...path].js")).href)).default;
  assert("the emitted entry loads as an ES module", typeof handler === "function");
} catch (error) {
  assert("the emitted entry loads as an ES module", false, error.message);
}

// Anything the function imports at runtime has to be emitted next to it; a
// missing file would only surface as a 500 on the deployed site.
for (const emitted of ["api/_lib/routes.js", "api/_lib/auth.js", "src/data/mockData.js"]) {
  let present = true;
  try {
    await import(pathToFileURL(join(workDir, emitted)).href);
  } catch {
    present = false;
  }
  assert(`${emitted} is emitted and resolves from the function`, present);
}

if (!handler) {
  console.log(`\n${failures} of ${checks} checks failed\n`);
  process.exit(1);
}

/* ------------------------------------------------------------------ */
/* 2. Drive the emitted handler over HTTP                              */
/* ------------------------------------------------------------------ */

process.chdir(isolatedCwd);

const server = createServer((req, res) => {
  void handler(req, res);
});
await new Promise((done) => server.listen(0, "127.0.0.1", done));
const { port } = server.address();

async function call(method, path, { body, token } = {}) {
  const response = await fetch(`http://127.0.0.1:${port}${path}`, {
    method,
    headers: {
      ...(body ? { "content-type": "application/json" } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  let payload = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }
  return { status: response.status, payload };
}

console.log("\nPass 1 — no credentials (seeded dataset)\n");

clearCredentials();
process.env.NODE_ENV = "development";

{
  const health = await call("GET", "/api/health");
  assert("GET /api/health answers 200", health.status === 200, `status ${health.status}`);
  assert("health reports demo mode", health.payload?.data?.mode === "demo", String(health.payload?.data?.mode));

  assert(
    "a seeded dataset publishes no auth configuration",
    health.payload?.data?.auth === null,
    JSON.stringify(health.payload?.data?.auth ?? null),
  );

  const profiles = await call("GET", "/api/demo/profiles");
  const count = profiles.payload?.data?.profiles?.length ?? 0;
  assert(
    "GET /api/demo/profiles lists the seeded identities",
    profiles.status === 200 && count >= 7,
    `status ${profiles.status}, ${count} profiles`,
  );

  const bootstrap = await call("GET", "/api/bootstrap");
  assert("GET /api/bootstrap answers 200", bootstrap.status === 200, `status ${bootstrap.status}`);
  assert(
    "bootstrap returns a profile and the hospital record",
    Boolean(bootstrap.payload?.data?.profile?.role) &&
      (bootstrap.payload?.data?.db?.medicines?.length ?? 0) > 0,
    JSON.stringify(bootstrap.payload?.error ?? null),
  );

  const missing = await call("GET", "/api/nope");
  assert("an unknown path answers 404", missing.status === 404, `status ${missing.status}`);
}

console.log("\nPass 2 — credentials present, no token (must be rejected)\n");

process.env.NODE_ENV = "production";
process.env.SUPABASE_URL = "https://example.supabase.co";
process.env.SUPABASE_ANON_KEY = "anon-key-placeholder";
process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-placeholder";

{
  const health = await call("GET", "/api/health");
  assert("health answers 200 before authentication", health.status === 200, `status ${health.status}`);
  assert("health reports supabase mode", health.payload?.data?.mode === "supabase");
  assert("health claims no identity", health.payload?.data?.authenticated === false);
  assert("health reports no role", health.payload?.data?.actorRole === null);

  // The browser needs the publishable key to reach the identity provider; the
  // service role key bypasses row level security and must never travel to it.
  assert(
    "health publishes the browser's auth configuration",
    health.payload?.data?.auth?.url === "https://example.supabase.co" &&
      health.payload?.data?.auth?.anonKey === "anon-key-placeholder",
    JSON.stringify(health.payload?.data?.auth ?? null),
  );
  assert(
    "no response carries the service role key",
    !JSON.stringify(health.payload).includes("service-role-placeholder"),
  );

  const bootstrap = await call("GET", "/api/bootstrap");
  assert(
    "GET /api/bootstrap without a token is rejected with 401",
    bootstrap.status === 401,
    `status ${bootstrap.status}`,
  );
  assert(
    "the rejection names the missing token",
    bootstrap.payload?.error?.code === "missing_token",
    String(bootstrap.payload?.error?.code),
  );

  const forged = await call("GET", "/api/bootstrap", { token: "not-a-real-token" });
  assert(
    "a forged token is not downgraded to a seeded administrator",
    forged.status === 401,
    `status ${forged.status}`,
  );

  const demo = await call("GET", "/api/demo/profiles");
  assert(
    "the demo identity list is refused on a credentialed deployment",
    demo.status === 404,
    `status ${demo.status}`,
  );
}

await new Promise((done) => server.close(done));

// Windows refuses to remove the process's own working directory.
process.chdir(root);
rmSync(workDir, { recursive: true, force: true });
rmSync(isolatedCwd, { recursive: true, force: true });

console.log(`\n${checks - failures} of ${checks} checks passed\n`);
process.exit(failures === 0 ? 0 : 1);
