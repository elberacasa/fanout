import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runChecks, type CommandOutcome } from "../src/gate/checks.ts";

/*
 * The gate runs the project's own checks rather than believing an agent's account of them. These tests are about
 * the two ways that could go wrong quietly: reporting a pass nobody earned, and reporting a failure as a pass.
 */

let repo: string;

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), "fanout-checks-"));
  const env = { PATH: process.env["PATH"] ?? "", HOME: process.env["HOME"] ?? "", LC_ALL: "C" };
  execFileSync("git", ["init", "--quiet"], { cwd: repo, env });
  execFileSync("git", ["config", "user.email", "a@b.invalid"], { cwd: repo, env });
  execFileSync("git", ["config", "user.name", "t"], { cwd: repo, env });
  writeFileSync(join(repo, "a.txt"), "one\n");
  execFileSync("git", ["add", "-A"], { cwd: repo, env });
  execFileSync("git", ["commit", "--quiet", "-m", "seed"], { cwd: repo, env });
});
afterEach(() => {
  rmSync(repo, { recursive: true, force: true });
});

const passes = (): CommandOutcome => ({ exitCode: 0, output: "ok", timedOut: false });
const fails = (output = "1 test failed"): CommandOutcome => ({ exitCode: 1, output, timedOut: false });

describe("running a line's checks", () => {
  it("passes only when every declared command passed", async () => {
    const result = await runChecks({
      cwd: repo,
      commands: ["npm run typecheck", "npm test"],
      run: () => Promise.resolve(passes()),
    });

    expect(result.ok).toBe(true);
    expect(result.commands).toEqual(["npm run typecheck", "npm test"]);
    expect(result.summary).toContain("2 checks passed");
  });

  it("stops at the first failure and names the command that broke", async () => {
    const run = vi.fn((command: string) => Promise.resolve(command === "npm test" ? fails() : passes()));
    const result = await runChecks({
      cwd: repo,
      commands: ["npm run typecheck", "npm test", "npm run e2e"],
      run,
    });

    expect(result.ok).toBe(false);
    expect(result.summary).toContain("npm test");
    // The third command's output after the second failed is noise; the answer was already settled.
    expect(run).toHaveBeenCalledTimes(2);
  });

  /*
   * The one that matters most. "Nothing failed" and "nothing ran" are different facts and only one of them is
   * evidence, so a line with no checks must never be reported as having passed them.
   */
  it("refuses to call a line with no checks a pass", async () => {
    const result = await runChecks({ cwd: repo, commands: [], run: () => Promise.resolve(passes()) });

    expect(result.ok).toBe(false);
    expect(result.summary).toContain("no checks were declared");
  });

  it("treats a command that never finished as a failure, and says so", async () => {
    const result = await runChecks({
      cwd: repo,
      commands: ["npm test"],
      run: () => Promise.resolve({ exitCode: null, output: "", timedOut: true }),
    });

    expect(result.ok).toBe(false);
    expect(result.summary).toContain("did not finish in time");
  });

  it("treats a command that could not start as a failure", async () => {
    const result = await runChecks({
      cwd: repo,
      commands: ["definitely-not-a-command"],
      run: () => Promise.resolve({ exitCode: null, output: "not found", timedOut: false }),
    });
    expect(result.ok).toBe(false);
  });

  it("keeps the end of a failing command's output, where it says why", async () => {
    const noise = Array.from({ length: 200 }, (_, i) => `line ${String(i)}`).join("\n");
    const result = await runChecks({
      cwd: repo,
      commands: ["npm test"],
      run: () => Promise.resolve(fails(`${noise}\nAssertionError: expected 12 to be 11`)),
    });

    expect(result.outcomes[0]?.tail).toContain("AssertionError");
    expect(result.outcomes[0]?.tail).not.toContain("line 0");
  });

  it("names the revision it ran against, so a merge can refuse work that moved since", async () => {
    const before = await runChecks({ cwd: repo, commands: ["true"], run: () => Promise.resolve(passes()) });
    writeFileSync(join(repo, "a.txt"), "two\n");
    const after = await runChecks({ cwd: repo, commands: ["true"], run: () => Promise.resolve(passes()) });

    expect(after.revision).not.toBe(before.revision);
  });
});

describe("actually running a command", () => {
  it("runs it in the worktree and believes the exit code", async () => {
    writeFileSync(join(repo, "ok.sh"), "#!/bin/sh\nexit 0\n");
    const result = await runChecks({ cwd: repo, commands: ["sh ok.sh"] });
    expect(result.ok).toBe(true);
  });

  it("reports a real failure as a failure", async () => {
    writeFileSync(join(repo, "bad.sh"), "#!/bin/sh\necho 'AssertionError: nope' >&2\nexit 1\n");
    const result = await runChecks({ cwd: repo, commands: ["sh bad.sh"] });

    expect(result.ok).toBe(false);
    expect(result.outcomes[0]?.tail).toContain("AssertionError");
  });

  it("kills a command that will not stop, rather than waiting for it", async () => {
    const started = Date.now();
    const result = await runChecks({ cwd: repo, commands: ["sleep 30"], timeoutMs: 300 });

    expect(result.ok).toBe(false);
    expect(result.summary).toContain("did not finish in time");
    expect(Date.now() - started).toBeLessThan(10_000);
  });

  it("gives a check the same closed environment an agent gets", async () => {
    // A check that quietly depends on a secret in the developer's shell is a check that fails on a colleague's
    // machine for reasons nobody can see.
    process.env["FANOUT_TEST_LEAK"] = "should-not-be-visible";
    try {
      writeFileSync(
        join(repo, "env.sh"),
        '#!/bin/sh\nexit $([ -z "$FANOUT_TEST_LEAK" ] && echo 0 || echo 1)\n',
      );
      const result = await runChecks({ cwd: repo, commands: ["sh env.sh"] });
      expect(result.ok).toBe(true);
    } finally {
      delete process.env["FANOUT_TEST_LEAK"];
    }
  });
});
