/**
 * Start the API and the Vite dev server together.
 *
 * Two processes, one terminal, no extra dependency. Output from both is
 * prefixed so it is obvious which one is talking. Ctrl+C stops both.
 */

import { spawn } from "node:child_process";

const npx = process.platform === "win32" ? "npx.cmd" : "npx";

const processes = [
  { name: "api", command: npx, args: ["tsx", "watch", "server/dev.ts"], colour: "\u001b[36m" },
  { name: "web", command: npx, args: ["vite"], colour: "\u001b[35m" },
];

const running = processes.map(({ name, command, args, colour }) => {
  const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"], shell: false });

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
