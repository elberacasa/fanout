import process from "node:process";
import { setInterval } from "node:timers";

process.stdout.write("x");
setInterval(() => {
  // Keep the fixture alive until the supervisor stops it.
}, 1000);
