import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
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
  say("packing the package…");
  run("pnpm", ["--filter", "fanout-cli", "pack", "--pack-destination", tarballs], {
    cwd: repo,
    stdio: ["ignore", "ignore", "inherit"],
  });

  const version = JSON.parse(readFileSync(join(repo, "packages/cli/package.json"), "utf8")).version;

  /*
   * One package. The workspace is bundled into it, so there is nothing to override and nothing that has to reach
   * the registry first — which is the whole reason it is one package.
   */
  run("mkdir", ["-p", project]);
  writeFileSync(
    join(project, "package.json"),
    JSON.stringify(
      {
        name: "fanout-pack-check",
        private: true,
        type: "module",
        dependencies: { "fanout-cli": `file:${join(tarballs, `fanout-cli-${version}.tgz`)}` },
      },
      null,
      2,
    ),
  );

  /*
   * Nothing published may claim a workspace package as a dependency: those are never going to npm again, so an
   * install would fail on a name that does not exist at this version. Checked from the tarball's own manifest,
   * which is the thing that actually ships.
   */
  const shipped = JSON.parse(
    run("tar", ["xzOf", join(tarballs, `fanout-cli-${version}.tgz`), "package/package.json"]),
  );
  const workspace = Object.keys(shipped.dependencies ?? {}).filter((name) => name.startsWith("fanout-"));
  if (workspace.length > 0) {
    say(`  ✗ the tarball still depends on ${workspace.join(", ")}, which is not published`);
    failed = true;
  }

  say("installing into an empty directory…");
  run("npm", ["install", "--silent", "--no-audit", "--no-fund"], {
    cwd: project,
    stdio: ["ignore", "ignore", "inherit"],
  });

  const fanout = join(project, "node_modules", ".bin", "fanout");
  const home = join(room, "home");

  /*
   * The plugin, from the layout a stranger actually has.
   *
   * For two releases the published package contained no plugin at all, and the one in the repository pointed at
   * `../packages/cli/src/cli.ts` — a git checkout and nothing else. The README's first sentence calls this a
   * Claude Code plugin, so what shipped was half of what it claimed, and nothing here could tell.
   */
  const launcher = join(project, "node_modules", "fanout-cli", "plugin", "bin", "fanout");
  const manifest = join(project, "node_modules", "fanout-cli", "plugin", ".claude-plugin", "plugin.json");
  if (!existsSync(manifest)) {
    say("  ✗ the package ships no plugin, which is the half of it the README leads with");
    failed = true;
  } else {
    const said = run(process.execPath, [launcher, "version"], { cwd: project }).trim();
    if (!said.endsWith(version)) {
      say(`  ✗ the plugin's launcher answered "${said}" rather than finding the bundled CLI`);
      failed = true;
    } else {
      say(`  ✓ the plugin finds its CLI: ${said}`);
    }
  }

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
