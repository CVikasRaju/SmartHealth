/**
 * Start the API and the Vite dev server together.
 *
 * Two processes, one terminal, no extra dependency. The CLIs are launched
 * through the current Node binary rather than through a shell shim, because
 * spawning `npx.cmd` on Windows throws EINVAL under Node 20+.
 *
 * Ctrl+C stops both.
 */

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));

/** Resolve a CLI shipped with a dependency, preferring the local install. */
function cliPath(...candidates) {
  for (const candidate of candidates) {
    const absolute = join(root, ...candidate);
    if (existsSync(absolute)) return absolute;
  }
  throw new Error(`None of these were found: ${candidates.map((parts) => parts.join("/")).join(", ")}`);
}

const tsx = cliPath(["node_modules", "tsx", "dist", "cli.mjs"]);
const vite = cliPath(["node_modules", "vite", "bin", "vite.js"]);

const processes = [
  { name: "api", script: tsx, args: ["watch", "server/dev.ts"], colour: "\u001b[36m" },
  { name: "web", script: vite, args: [], colour: "\u001b[35m" },
];

const running = processes.map(({ name, script, args, colour }) => {
  const child = spawn(process.execPath, [script, ...args], {
    cwd: root,
    stdio: ["ignore", "pipe", "pipe"],
  });

  const prefix = `${colour}[${name}]\u001b[0m`;
  const relay = (stream, target) => {
    stream.setEncoding("utf8");
    let buffer = "";
    stream.on("data", (chunk) => {
      buffer += chunk;
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) target.write(`${prefix} ${line}\n`);
    });
  };

  relay(child.stdout, process.stdout);
  relay(child.stderr, process.stderr);

  child.on("error", (error) => {
    process.stdout.write(`${prefix} could not start: ${error.message}\n`);
  });

  child.on("exit", (code) => {
    process.stdout.write(`${prefix} exited with code ${code ?? 0}\n`);
    shutdown();
  });

  return child;
});

let stopping = false;
function shutdown() {
  if (stopping) return;
  stopping = true;
  for (const child of running) {
    if (!child.killed) child.kill();
  }
  setTimeout(() => process.exit(0), 200);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
