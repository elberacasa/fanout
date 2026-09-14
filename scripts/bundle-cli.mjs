import { build } from "esbuild";
import { cpSync, mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/*
 * Publishing Fanout as one package instead of eight.
 *
 * It began as eight because the repository is eight workspace packages, and that shape leaked straight onto npm.
 * Nobody ever wanted `fanout-core`: seven of those existed only because `fanout-cli` imported them. The cost was
 * not tidiness — it was that every release meant eight uploads, and on an account with a passkey that is eight
 * separate touches of a fingerprint sensor. A release process that tiring is a release process that gets skipped.
 *
 * So the workspace code is bundled into the CLI at publish time. `zod`, `ws` and the MCP SDK stay external and
 * remain real dependencies: they are somebody else's published packages, and inlining them would bloat the
 * tarball and bury their licences.
 *
 * Two entry points, not one. The simulated agent is spawned as a separate process, so it has to exist as its own
 * file — bundled into the CLI it would be unreachable, and `FAKE_CLI_PATH` would resolve to the lead's own CLI
 * and spawn the demo inside itself.
 */

const cli = fileURLToPath(new URL("../packages/cli/", import.meta.url));
const dist = join(cli, "dist");

/** Left to npm, not bundled: other people's packages, with their own versions and licences. */
const EXTERNAL = ["zod", "ws", "@modelcontextprotocol/sdk", "@modelcontextprotocol/sdk/*"];

rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });

await build({
  entryPoints: {
    cli: join(cli, "src/cli.ts"),
    "fake-agent": fileURLToPath(new URL("../packages/adapters/fake/src/cli.ts", import.meta.url)),
  },
  outdir: dist,
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  // Node 22.18 is the floor we claim; anything newer is the user's business and not ours to assume.
  external: EXTERNAL,
  sourcemap: true,
  legalComments: "inline",
  logLevel: "warning",
});

/*
 * The mission view, which the daemon reads from beside its own module at runtime. A bundle without it serves a
 * page that does not exist, and nothing in a build would notice — the failure only appears when somebody opens it.
 */
const view = fileURLToPath(new URL("../packages/daemon/src/api/view.html", import.meta.url));
cpSync(view, join(dist, "view.html"));

const licence = fileURLToPath(new URL("../LICENSE", import.meta.url));
cpSync(licence, join(cli, "LICENSE"));

/*
 * The plugin, copied in *as* the package root rather than into a `plugin/` subdirectory.
 *
 * It lives at the repository root because that is where a checkout wants it, and npm cannot include a file from
 * outside the package being packed — so publishing it means copying it in.
 *
 * The subdirectory is what broke it. Claude Code treats the installed package's own root as the plugin root and
 * looks for `.claude-plugin/plugin.json` there; ours was one level down at `plugin/.claude-plugin/plugin.json`,
 * so the plugin installed, reported itself enabled, and loaded nothing at all — no commands, no skills, no MCP
 * server. `claude plugin validate` on the installed package says it plainly: "No manifest found in directory."
 *
 * So the contents are flattened. `bin/fanout` then resolves `../dist/cli.js`, which is where the bundle above
 * put it.
 */
const plugin = fileURLToPath(new URL("../plugin/", import.meta.url));
rmSync(join(cli, "plugin"), { recursive: true, force: true });
for (const entry of readdirSync(plugin)) {
  rmSync(join(cli, entry), { recursive: true, force: true });
  cpSync(join(plugin, entry), join(cli, entry), { recursive: true });
}

for (const required of [
  "cli.js",
  "fake-agent.js",
  "view.html",
  "../bin/fanout",
  "../.mcp.json",
  "../.claude-plugin/plugin.json",
]) {
  const path = join(dist, required);
  if (!statSync(path, { throwIfNoEntry: false })?.isFile()) {
    throw new Error(`bundle is missing ${required}; refusing to publish a package that cannot run`);
  }
  process.stdout.write(`  ${required}  ${String(Math.round(statSync(path).size / 1024))} kB\n`);
}
