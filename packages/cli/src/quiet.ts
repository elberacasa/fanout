/*
 * Swallowing one warning, and only one.
 *
 * The ledger is Node's built-in SQLite, so every `fanout` command opened with two lines nobody asked for:
 *
 *   (node:38137) ExperimentalWarning: SQLite is an experimental feature and might change at any time
 *   (Use `node --trace-warnings ...` to show where the warning was created)
 *
 * That is the first thing a person ever sees of this product, before a single word of our own, and it reads as
 * something going wrong. It is not news to them: the choice was ours, it is written down (ADR 0002), and the
 * minimum Node version in `engines` is the promise that it works. A warning the user can do nothing about, on
 * every invocation, is noise pretending to be information.
 *
 * Narrow on purpose. `process.removeAllListeners("warning")` would have been one line and would have hidden
 * every future deprecation from us as well — the sort of silence that is discovered two majors late. This keeps
 * Node's own printer and gives it back everything except the one warning we already know about.
 *
 * Imported before anything else in `cli.ts`: ESM evaluates imports in order, and the warning fires the moment
 * `node:sqlite` is first loaded, which happens while the modules below are still being evaluated.
 */

const printers = process.listeners("warning");
process.removeAllListeners("warning");

process.on("warning", (warning) => {
  const ours = warning.name === "ExperimentalWarning" && warning.message.includes("SQLite");
  if (ours) return;
  for (const printer of printers) printer(warning);
});
