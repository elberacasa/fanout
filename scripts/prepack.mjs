import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { execFileSync } from "node:child_process";

/*
 * Turning a package into something npm can actually ship.
 *
 * Fanout has no build step, and that stays true for everyone working in the repository: Node runs our TypeScript
 * directly, the CLI is `node cli.ts`, and the plugin runs out of a checkout (ADR 0015). It cannot stay true for a
 * published package, and not as a matter of preference — Node refuses to strip types from any file under
 * `node_modules` and throws `ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING`. A package of `.ts` files would fail on
 * the first import on every machine that installed it. So the tarball carries compiled JavaScript (ADR 0021).
 *
 * Run by npm as `prepack`, which means it runs for `npm pack` and `npm publish` alike. That matters: the way we
 * check the tarball is the way it gets built, rather than a separate path that could drift from it.
 */

const packageRoot = process.cwd();
const dist = join(packageRoot, "dist");

// A stale `dist` is how a file deleted from `src` ships anyway, months after it stopped existing.
rmSync(dist, { recursive: true, force: true });

execFileSync("npx", ["tsc", "-p", "tsconfig.build.json"], { cwd: packageRoot, stdio: "inherit" });

/*
 * Everything `src` holds that the compiler does not consider its business. The mission view is one HTML file
 * loaded at runtime from beside its module, so a tarball without it publishes a daemon whose only screen is a
 * crash — the exact kind of failure a green build hides until someone installs it.
 */
const ASSETS = new Set([".html", ".css", ".json", ".md", ".txt"]);
const src = join(packageRoot, "src");

/** @param {string} directory */
function copyAssets(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const from = join(directory, entry.name);
    if (entry.isDirectory()) {
      copyAssets(from);
      continue;
    }
    if (!ASSETS.has(entry.name.slice(entry.name.lastIndexOf(".")))) continue;
    const to = join(dist, relative(src, from));
    mkdirSync(dirname(to), { recursive: true });
    cpSync(from, to);
    process.stdout.write(`  carried ${relative(packageRoot, to)}\n`);
  }
}

if (existsSync(src)) copyAssets(src);

// The licence travels with the code, in every package, because each one is published on its own.
const license = join(packageRoot, "..", "..", "LICENSE");
const nested = join(packageRoot, "..", "..", "..", "LICENSE");
const found = existsSync(license) ? license : existsSync(nested) ? nested : null;
if (found !== null) cpSync(found, join(packageRoot, "LICENSE"));

if (!existsSync(dist) || !statSync(dist).isDirectory()) {
  throw new Error("prepack produced no dist directory; refusing to publish an empty package");
}
