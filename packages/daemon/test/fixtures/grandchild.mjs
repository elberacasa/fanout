import process from "node:process";
import { setInterval } from "node:timers";
import { URL } from "node:url";

import { spawn } from "node:child_process";

const stubborn = process.argv[2] === "stubborn";
const child = spawn(
  process.execPath,
  [new URL(stubborn ? "ignore-term.mjs" : "sleep.mjs", import.meta.url).pathname],
  { env: {}, stdio: ["ignore", "pipe", "ignore"] },
);
child.stdout.once("data", () => {
  process.stdout.write(`${child.pid}\n`);
});
if (!stubborn) {
  // Reap the child before exiting so the probe cannot mistake a zombie for a live process.
  process.on("SIGTERM", () => {
    // Wait for the child exit event so its process is reaped.
  });
  child.once("exit", () => {
    process.exit(0);
  });
}
setInterval(() => {
  // Keep the fixture alive until the supervisor stops it.
}, 1000);
