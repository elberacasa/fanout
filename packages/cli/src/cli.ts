#!/usr/bin/env node
import { main } from "./main.ts";

/* The thin edge of the CLI: everything testable lives in main.ts, which takes its output as an argument. */

const code = await main(process.argv.slice(2), {
  out: (text) => process.stdout.write(text),
  err: (text) => process.stderr.write(text),
});
process.exitCode = code;
