import { setInterval } from "node:timers";

setInterval(() => {
  // Keep the fixture alive until the supervisor stops it.
}, 1000);
