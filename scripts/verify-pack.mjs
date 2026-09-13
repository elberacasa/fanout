import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/*
 * Installing what we would publish, into an empty directory, and running it.
 *
 * Everything else in this repository tests the source. This tests the *package*, which is a different artifact
 * with its own ways of being wrong, and none of them are visible from a checkout:
 *
 *   - a runtime file the compiler ignores and `files` does not ship (the adapter manifests, the mission view);
 *   - a path built as a string, which the compiler cannot rewrite (`./cli.ts` beside a `cli.js`);
 *   - a version written down by hand that no longer matches the package it names.
 *
 * All three were real, all three were found here, and all three passed `npm run check` while broken. A green suite
 * says the source is right; only this says a stranger can install it.
 *
 * It is deliberately the whole journey — pack, install, `version`, then the demo end to end — because the demo is
 * the product's front door and a front door that fails is worse than no front door.
 */

const repo = fileURLToPath(new URL("..", import.meta.url));
const room = mkdtempSync(join(tmpdir(), "fanout-pack-"));
const tarballs = join(room, "tarballs");
const project = join(room, "project");
let failed = false;

/** @param {string} line */
const say = (line) => process.stdout.write(`${line}\n`);

/**
 * @param {string} command
 * @param {readonly string[]} args
 * @param {import("node:child_process").ExecFileSyncOptions} [options]
 */
const run = (command, args, options = {}) =>
  String(execFileSync(command, args, { encoding: "utf8", ...options }));

try {
  say("packing every package…");
  run("pnpm", ["-r", "--filter", "./packages/**", "pack", "--pack-destination", tarballs], {
    cwd: repo,
    stdio: ["ignore", "ignore", "inherit"],
  });

  const packed = readdirSync(tarballs).filter((name) => name.endsWith(".tgz"));
  const version = JSON.parse(readFileSync(join(repo, "packages/cli/package.json"), "utf8")).version;

  /*
   * `overrides` so the install resolves to these tarballs rather than to whatever the registry happens to hold —
   * which, the first time this runs for a version, is nothing at all.
   *
   * A tarball is named `<package>-<version>.tgz`, so stripping the version suffix gives the package name back.
   */
  /** @type {Record<string, string>} */
  const overrides = {};
  for (const name of packed) {
    if (name === `fanout-cli-${version}.tgz`) continue;
    overrides[name.replace(`-${version}.tgz`, "")] = `file:${join(tarballs, name)}`;
  }

  run("mkdir", ["-p", project]);
  writeFileSync(
    join(project, "package.json"),
    JSON.stringify(
      {
        name: "fanout-pack-check",
        private: true,
        type: "module",
        dependencies: { "fanout-cli": `file:${join(tarballs, `fanout-cli-${version}.tgz`)}` },
        overrides,
      },
      null,
      2,
    ),
  );

  say("installing into an empty directory…");
  run("npm", ["install", "--silent", "--no-audit", "--no-fund"], {
    cwd: project,
    stdio: ["ignore", "ignore", "inherit"],
  });

  const fanout = join(project, "node_modules", ".bin", "fanout");
  const home = join(room, "home");

  const reported = run(fanout, ["version"], { cwd: project }).trim();
  if (!reported.endsWith(version)) {
    say(`  ✗ \`fanout version\` said "${reported}", but the package is ${version}`);
    failed = true;
  } else {
    say(`  ✓ ${reported}`);
  }

  /*
   * The demo, to completion, in a fresh home. It exercises the adapters, the workspaces, the ledger, the API and
   * the mission view — every part of the installed package that a checkout resolves differently.
   */
  say("running the demo the way a stranger would…");
  const demo = run(fanout, ["demo", "--once"], {
    cwd: project,
    env: { ...process.env, HOME: home },
    timeout: 180_000,
  });

  /*
   * Read from the demo's own rows rather than a summary line. Piped, each agent prints one line per state it
   * reaches — `Agent 1 · CSV export endpoint · done — +13 −0` — so counting them says both that the agents ran
   * and that they finished, which a single summary number cannot distinguish from a mission that dropped two.
   */
  const rows = demo.split("\n");
  const done = rows.filter((line) => line.includes(" · done — "));
  const broken = rows.filter((line) => line.includes(" · failed — "));

  if (broken.length > 0) {
    say("  ✗ the demo ran but its agents failed:");
    say(broken.map((line) => `      ${line.trim()}`).join("\n"));
    failed = true;
  } else if (done.length !== 3) {
    say(`  ✗ the demo finished ${String(done.length)} of its 3 agents`);
    say(
      rows
        .slice(-12)
        .map((line) => `      ${line}`)
        .join("\n"),
    );
    failed = true;
  } else {
    say(`  ✓ the demo finished: ${String(done.length)} agents, none failed`);
  }
} catch (cause) {
  // The end of a failed command's output is where it says why, and that is the whole value of this script failing.
  const error = /** @type {{ message?: string; stdout?: string }} */ (cause);
  say(`  ✗ ${error.message ?? String(cause)}`);
  if (error.stdout !== undefined) say(error.stdout.split("\n").slice(-15).join("\n"));
  failed = true;
} finally {
  rmSync(room, { recursive: true, force: true });
}

if (failed) {
  say("\nThe package is not publishable as it stands.");
  process.exit(1);
}
say("\nThe package installs and runs from empty.");
