#!/usr/bin/env node
// First, and it has to stay first: it silences a warning that fires while the imports below are evaluating.
import "./quiet.ts";
import { main } from "./main.ts";

/* The thin edge of the CLI: everything testable lives in main.ts, which takes its output as an argument. */

const code = await main(process.argv.slice(2), {
  out: (text) => process.stdout.write(text),
  err: (text) => process.stderr.write(text),
});
process.exitCode = code;
