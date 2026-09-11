import process from "node:process";
import { setInterval } from "node:timers";

process.on("SIGTERM", () => {
  process.stderr.write("ignored SIGTERM\n");
});
process.stdout.write("ready\n");
setInterval(() => {
  // Keep the fixture alive until the supervisor stops it.
}, 1000);
