/*
 * Refuses to publish a package whose entry points do not exist in the tarball.
 *
 * This exists because `fanout-cli@0.9.1` went to the registry broken and stayed there. Its `bin` pointed at
 * `./src/cli.ts` and its `exports` at `./src/main.ts` — raw TypeScript, which Node refuses to strip under
 * `node_modules` (ADR 0021, the whole reason this package is bundled). A clean `npm install fanout-cli` could
 * not run `fanout version`, and the website's own fallback, `npx fanout-cli demo`, was dead.
 *
 * The cause was an indirection that only worked under one tool. `publishConfig.bin` and `publishConfig.exports`
 * are a pnpm feature: pnpm rewrites the manifest when it packs, npm does not. The release had always been "pnpm
 * to pack, npm to upload", so the trick had held; the first plain `npm publish` shipped the checkout's own
 * paths, and npm said so in a warning among nine other warnings.
 *
 * The manifest now names `dist/` in one place and there is nothing to rewrite. This guard is the belt: it runs
 * as `prepublishOnly`, which fires for npm and pnpm alike, and it checks the thing that actually matters —
 * whether the files the manifest promises are really there — rather than restating the rule it is enforcing.
 */

import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { readFileSync } from "node:fs";

const pkgDir = process.cwd();

/** @type {unknown} */
const parsed = JSON.parse(readFileSync(join(pkgDir, "package.json"), "utf8"));
if (typeof parsed !== "object" || parsed === null) throw new Error("package.json does not hold an object");
const manifest = /** @type {Record<string, any>} */ (parsed);

/** Every path the manifest promises a consumer, flattened out of `bin` and `exports`. */
const promised = [];

for (const [name, target] of Object.entries(manifest["bin"] ?? {})) {
  promised.push({ what: `bin.${name}`, path: String(target) });
}

/** @param {string} where @param {unknown} node */
const walkExports = (where, node) => {
  if (typeof node === "string") {
    promised.push({ what: where, path: node });
    return;
  }
  if (typeof node !== "object" || node === null) return;
  for (const [key, child] of Object.entries(node)) walkExports(`${where}.${key}`, child);
};
walkExports("exports", manifest["exports"]);

const problems = [];

for (const entry of promised) {
  // TypeScript in a published package is not a style question: Node throws for any `.ts` under node_modules.
  if (/\.[cm]?ts$/.test(entry.path)) {
    problems.push(
      `${entry.what} points at TypeScript (${entry.path}); Node cannot load it from node_modules`,
    );
    continue;
  }
  if (!existsSync(resolve(pkgDir, entry.path))) {
    problems.push(`${entry.what} points at ${entry.path}, which does not exist — has prepack run?`);
  }
}

/*
 * A `publishConfig` that rewrites `bin` or `exports` is the trap itself: it works under pnpm, does nothing under
 * npm, and the difference is a warning nobody reads in a wall of nine.
 */
for (const key of ["bin", "exports", "main"]) {
  if (manifest["publishConfig"]?.[key] !== undefined) {
    problems.push(
      `publishConfig.${key} is a pnpm-only rewrite and is silently ignored by npm — set ${key} directly`,
    );
  }
}

const say = (/** @type {string} */ line) => process.stdout.write(`${line}\n`);
const warn = (/** @type {string} */ line) => process.stderr.write(`${line}\n`);

if (problems.length > 0) {
  warn(`\nRefusing to publish ${String(manifest["name"])}@${String(manifest["version"])}:\n`);
  for (const problem of problems) warn(`  ${problem}`);
  warn("\n0.9.1 shipped this way and could not run at all. Fix the manifest, do not publish around it.\n");
  process.exit(1);
}

say(`publish check: ${String(promised.length)} entry point(s), all present, none TypeScript`);
