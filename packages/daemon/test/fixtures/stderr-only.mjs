import process from "node:process";
import { setInterval } from "node:timers";

process.stderr.write("not started\n");
setInterval(() => {
  // Keep the fixture alive until the supervisor stops it.
}, 1000);
