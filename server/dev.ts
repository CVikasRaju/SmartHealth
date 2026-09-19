/**
 * Local API server.
 *
 * Runs the production router over `node:http` so the stack can be developed
 * without the Vercel CLI. In demo mode it serves the seeded dataset, cached for
 * the life of the process, so writes survive between requests the way they would
 * against Postgres.
 *
 *   npm run dev:api      # this server on :8787
 *   npm run dev          # Vite on :5173, proxying /api here
 *   npm run dev:stack    # both, in one terminal
 */

import { createServer, type IncomingMessage } from "node:http";

import { readConfig } from "../api/_lib/config";
import { API_HEADERS, buildApiRequest } from "../api/_lib/http";
import { API_ROUTES, routeRequest } from "../api/_lib/routes";
import { getRepository } from "../api/_lib/repo";

const port = Number(process.env.PORT ?? 8787);

async function readStreamBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : (chunk as Buffer));
  }
  if (chunks.length === 0) return null;

  const text = Buffer.concat(chunks).toString("utf8");
  if (text.trim().length === 0) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

async function main(): Promise<void> {
  let config;
  try {
    config = readConfig();
  } catch (error) {
    console.error(`\n[smartmedic] ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
    return;
  }

  const server = createServer((req, res) => {
    void (async () => {
      const body = await readStreamBody(req);
      const apiRequest = buildApiRequest({
        method: req.method,
        url: req.url,
        headers: req.headers,
        body,
      });

      const { status, payload } = await routeRequest(apiRequest, config);

      res.statusCode = status;
      for (const [name, value] of Object.entries(API_HEADERS)) res.setHeader(name, value);
      res.end(JSON.stringify(payload));
    })();
  });

  server.listen(port, () => {
    console.log("");
    console.log(`  SmartMedic API  http://127.0.0.1:${port}`);
    console.log(`  mode            ${config.mode === "demo" ? "demo (seeded in-memory data)" : "supabase (Postgres)"}`);
    console.log(`  endpoints       ${API_ROUTES.length}`);
    console.log("");
  });

  if (config.mode === "demo") {
    const profiles = await getRepository(config).listProfiles();
    const staff = profiles.filter((profile) => profile.role !== "patient");
    console.log("  Demo identities (the browser signs in without a password):");
    for (const profile of staff) {
      console.log(`    ${profile.role.padEnd(13)} ${profile.fullName}  <${profile.email}>`);
    }
    console.log(
      `    ${"patient".padEnd(13)} ${profiles.filter((p) => p.role === "patient").map((p) => p.fullName).join(", ")}`,
    );
    console.log("");
  }
}

void main();
