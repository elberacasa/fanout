/*
 * The plugin manifest and the package must claim the same version.
 *
 * This exists because they did not. `packages/cli/package.json` was at `0.9.0` — published, tagged, announced —
 * while `plugin/.claude-plugin/plugin.json` still said `0.6.0`, three releases behind, and had done for every
 * release in between. Nothing noticed, because nothing was looking: the version in the manifest is read by
 * Claude Code when it lists an installed plugin, so the only symptom is a user being told they are running
 * something they are not.
 *
 * It is the same shape as every other bug worth fixing structurally in this repository — a fact duplicated in
 * two files with nothing holding them together. `npm run check` now holds them together.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * @param {string} path
 * @returns {Record<string, unknown>}
 */
function read(path) {
  // Typed `unknown` rather than taking `JSON.parse`'s `any` straight through, which is how a typo in a field
  // name becomes `undefined` and the check passes while comparing nothing.
  /** @type {unknown} */
  const parsed = JSON.parse(readFileSync(join(root, path), "utf8"));
  if (typeof parsed !== "object" || parsed === null) throw new Error(`${path} does not hold an object`);
  return /** @type {Record<string, unknown>} */ (parsed);
}

/** @param {string} line */
const say = (line) => process.stdout.write(`${line}\n`);
/** @param {string} line */
const warn = (line) => process.stderr.write(`${line}\n`);

/**
 * Every place the product's version is written down.
 *
 * The marketplace entry was added after `claude plugin list` reported `Version: unknown` for an installed
 * plugin — the entry carried no version, so nothing had one to report. That is a third copy of the same fact,
 * which is a third chance to drift, which is why it is here rather than only fixed.
 */
const SOURCES = [
  { path: "packages/cli/package.json", at: ["version"] },
  { path: "plugin/.claude-plugin/plugin.json", at: ["version"] },
  { path: ".claude-plugin/marketplace.json", at: ["plugins", "0", "version"] },
];

/** Walks a path of keys without ever handing `any` back out. */
const dig = (/** @type {unknown} */ node, /** @type {readonly string[]} */ keys) => {
  /** @type {unknown} */
  let here = node;
  for (const key of keys) {
    if (typeof here !== "object" || here === null) return undefined;
    here = /** @type {Record<string, unknown>} */ (here)[key];
  }
  return here;
};

const found = SOURCES.map((source) => ({
  path: source.path,
  value: String(dig(read(source.path), source.at)),
}));
// SOURCES is a non-empty literal, so there is always a first; the check is for the typechecker, not for a case.
const first = found[0];
if (first === undefined) throw new Error("check-versions: no sources to compare");

if (found.some((other) => other.value !== first.value)) {
  warn("\nThe version is not the same everywhere:\n");
  for (const source of found) warn(`  ${source.value}  ${source.path}`);
  warn(
    "\nClaude Code shows the manifest's version for an installed plugin, so a stale one tells a user\n" +
      "they are running something they are not. Set them all to the version you are shipping.\n",
  );
  process.exit(1);
}

say(`version: ${first.value}, agreed by ${String(found.length)} files`);
