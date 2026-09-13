import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/*
 * The first thing anyone ever sees of this product.
 *
 * Every `fanout` command used to open with two lines about SQLite being experimental — before a word of our own,
 * about a decision the user did not make and cannot act on. It reads as something going wrong.
 *
 * Spawned for real rather than unit-tested, because the whole difficulty is *when* the warning fires: ESM
 * resolves every static import before any module body runs, so a filter installed by an imported module is
 * already too late. Only running the binary proves the ordering holds — and it is exactly the ordering that a
 * later refactor would quietly undo by making `node:sqlite` a static import again.
 */

const cli = fileURLToPath(new URL("../src/cli.ts", import.meta.url));

/**
 * Runs the CLI for real, with an environment that suppresses nothing on its behalf.
 *
 * `spawnSync` rather than `execFileSync`, and that is the whole reason this comment exists: `execFileSync`
 * returns stdout and nothing else, so the first version of this test asserted that an always-empty string did
 * not contain a warning. It passed against the broken code it was written to catch.
 */
function run(args: string[]): { stdout: string; stderr: string } {
  const result = spawnSync(process.execPath, [cli, ...args], {
    encoding: "utf8",
    env: { PATH: process.env["PATH"] ?? "", HOME: process.env["HOME"] ?? "" },
  });
  return { stdout: result.stdout, stderr: result.stderr };
}

describe("what the CLI prints before it says anything", () => {
  it("says nothing about SQLite being experimental", () => {
    const { stdout, stderr } = run(["version"]);

    expect(stderr).not.toContain("ExperimentalWarning");
    expect(stderr).not.toContain("SQLite");
    // And it did print its own output, so this is silence from a working command rather than from a broken one.
    expect(stdout).toMatch(/^fanout \d+\.\d+\.\d+/);
  });

  /*
   * The narrow filter is the point. `process.removeAllListeners("warning")` would also have passed this test
   * and hidden every future deprecation from us — the sort of silence discovered two majors late.
   */
  it("still prints warnings that are not that one", () => {
    const script = [
      `import ${JSON.stringify(fileURLToPath(new URL("../src/quiet.ts", import.meta.url)))};`,
      `process.emitWarning("a real problem", "DeprecationWarning");`,
    ].join("\n");

    const { stderr } = spawnSync(process.execPath, ["--input-type=module", "-e", script], {
      encoding: "utf8",
    });

    expect(stderr).toContain("a real problem");
    expect(stderr).toContain("DeprecationWarning");
  });

  it("says nothing about the one warning it is there to swallow", () => {
    const script = [
      `import ${JSON.stringify(fileURLToPath(new URL("../src/quiet.ts", import.meta.url)))};`,
      `process.emitWarning("SQLite is an experimental feature", "ExperimentalWarning");`,
    ].join("\n");

    const { stderr } = spawnSync(process.execPath, ["--input-type=module", "-e", script], {
      encoding: "utf8",
    });

    expect(stderr).toBe("");
  });
});
