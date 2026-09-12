import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { looksLikeATest, proveFix } from "../src/gate/proof.ts";

/*
 * The fourth non-negotiable, in code. A test that passes on the new code proves the new code passes its own test;
 * only a test that FAILS on the old code proves the test is about the bug. Every path here bends towards refusing.
 */

const env = { PATH: process.env["PATH"] ?? "", HOME: process.env["HOME"] ?? "", LC_ALL: "C" };
let repo: string;
let work: string;

const git = (args: string[], cwd = repo): string => execFileSync("git", args, { cwd, env, encoding: "utf8" });

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), "fanout-proof-repo-"));
  mkdirSync(join(repo, "src"));
  mkdirSync(join(repo, "test"));
  // The bug: months are zero-based.
  writeFileSync(join(repo, "src", "dates.js"), "exports.monthOf = (d) => d.getMonth();\n");
  writeFileSync(
    join(repo, "run-tests.sh"),
    "#!/bin/sh\nnode -e \"const t=require('./test/dates.test.js'); t();\" 2>&1\n",
  );
  git(["init", "--quiet", "-b", "main"]);
  git(["config", "user.email", "a@b.invalid"]);
  git(["config", "user.name", "t"]);
  git(["add", "-A"]);
  git(["commit", "--quiet", "-m", "the bug"]);

  work = mkdtempSync(join(tmpdir(), "fanout-proof-work-"));
  rmSync(work, { recursive: true, force: true });
  git(["worktree", "add", "--detach", "--quiet", work, "HEAD"]);
});

afterEach(() => {
  execFileSync("git", ["worktree", "remove", "--force", work], { cwd: repo, env, stdio: "ignore" });
  rmSync(repo, { recursive: true, force: true });
});

const base = (): string => git(["rev-parse", "HEAD"]).trim();

/** The agent's work: the fix, and a test that only passes because of it. */
function writeFixAndTest(): void {
  // git tracks no empty directory, so the worktree has no test/ until something is put in it.
  mkdirSync(join(work, "test"), { recursive: true });
  writeFileSync(join(work, "src", "dates.js"), "exports.monthOf = (d) => d.getMonth() + 1;\n");
  writeFileSync(
    join(work, "test", "dates.test.js"),
    "const { monthOf } = require('../src/dates.js');\n" +
      "module.exports = () => {\n" +
      "  const got = monthOf(new Date('2026-12-01T12:00:00Z'));\n" +
      "  if (got !== 12) { console.error('expected 12, got ' + got); process.exit(1); }\n};\n",
  );
}

describe("what counts as a test file", () => {
  it.each([
    "test/dates.test.js",
    "src/dates.test.ts",
    "src/__tests__/dates.js",
    "tests/thing.py",
    "pkg/thing_test.go",
    "app/test_thing.py",
    "spec/thing.rb",
  ])("recognises %s", (path) => {
    expect(looksLikeATest(path)).toBe(true);
  });

  it.each(["src/dates.js", "README.md", "src/latest.ts", "contest/entry.ts"])(
    "does not mistake %s for one",
    (path) => {
      expect(looksLikeATest(path)).toBe(false);
    },
  );
});

describe("proving a fix", () => {
  it("passes when the new test fails on the old code", async () => {
    writeFixAndTest();
    const result = await proveFix({
      repoRoot: repo,
      workspacePath: work,
      baseCommit: base(),
      touched: ["src/dates.js", "test/dates.test.js"],
      commands: ["sh run-tests.sh"],
    });

    expect(result.ok).toBe(true);
    expect(result.tests).toEqual(["test/dates.test.js"]);
    expect(result.failedOnOld).toEqual(["test/dates.test.js"]);
  });

  /*
   * The failure this whole mechanism exists to catch: a test that would have passed before the fix. It proves
   * nothing about the bug, however green it looks on the new code.
   */
  it("refuses a test that passes on the old code too", async () => {
    mkdirSync(join(work, "test"), { recursive: true });
    writeFileSync(join(work, "src", "dates.js"), "exports.monthOf = (d) => d.getMonth() + 1;\n");
    writeFileSync(
      join(work, "test", "dates.test.js"),
      "const d = require('../src/dates.js');\nmodule.exports = () => { if (typeof d.monthOf !== 'function') process.exit(1); };\n",
    );

    const result = await proveFix({
      repoRoot: repo,
      workspacePath: work,
      baseCommit: base(),
      touched: ["src/dates.js", "test/dates.test.js"],
      commands: ["sh run-tests.sh"],
    });

    expect(result.ok).toBe(false);
    expect(result.why).toContain("pass on the old code");
  });

  it("puts only the tests on the old code, never the fix", async () => {
    // If the fix travelled with them the test would pass and every proof would be worthless.
    writeFixAndTest();
    const result = await proveFix({
      repoRoot: repo,
      workspacePath: work,
      baseCommit: base(),
      touched: ["src/dates.js", "test/dates.test.js"],
      commands: ["sh run-tests.sh"],
    });
    expect(result.ok).toBe(true);
  });

  it("refuses a fix that changed no test at all", async () => {
    writeFileSync(join(work, "src", "dates.js"), "exports.monthOf = (d) => d.getMonth() + 1;\n");
    const result = await proveFix({
      repoRoot: repo,
      workspacePath: work,
      baseCommit: base(),
      touched: ["src/dates.js"],
      commands: ["sh run-tests.sh"],
    });

    expect(result.ok).toBe(false);
    expect(result.why).toContain("nothing to prove it with");
  });

  it("refuses when the line declares no command that could run a test", async () => {
    writeFixAndTest();
    const result = await proveFix({
      repoRoot: repo,
      workspacePath: work,
      baseCommit: base(),
      touched: ["test/dates.test.js"],
      commands: [],
    });

    expect(result.ok).toBe(false);
    expect(result.why).toContain("no checks");
  });

  it("refuses when the check could not run at all, rather than reading that as a failing test", async () => {
    writeFixAndTest();
    const result = await proveFix({
      repoRoot: repo,
      workspacePath: work,
      baseCommit: base(),
      touched: ["test/dates.test.js"],
      commands: ["definitely-not-a-command-anywhere"],
      runChecksImpl: () =>
        Promise.resolve({
          ok: false,
          revision: "0".repeat(64),
          commands: ["definitely-not-a-command-anywhere"],
          summary: "could not start",
          outcomes: [
            {
              command: "definitely-not-a-command-anywhere",
              exitCode: null,
              timedOut: false,
              tail: "not found",
            },
          ],
        }),
    });

    expect(result.ok).toBe(false);
    expect(result.why).toContain("nothing was proven");
  });

  it("leaves no worktree behind when it is done", async () => {
    writeFixAndTest();
    const before = git(["worktree", "list"]).trim().split("\n").length;
    await proveFix({
      repoRoot: repo,
      workspacePath: work,
      baseCommit: base(),
      touched: ["src/dates.js", "test/dates.test.js"],
      commands: ["sh run-tests.sh"],
    });
    expect(git(["worktree", "list"]).trim().split("\n")).toHaveLength(before);
  });
});
