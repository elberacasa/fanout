import { execFileSync } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runChecks, type CommandOutcome } from "../src/gate/checks.ts";

/*
 * The gate runs the project's own checks rather than believing an agent's account of them. These tests are about
 * the two ways that could go wrong quietly: reporting a pass nobody earned, and reporting a failure as a pass.
 */

let repo: string;

const gitEnv = { PATH: process.env["PATH"] ?? "", HOME: process.env["HOME"] ?? "", LC_ALL: "C" };

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), "fanout-checks-"));
  const env = gitEnv;
  execFileSync("git", ["init", "--quiet"], { cwd: repo, env });
  execFileSync("git", ["config", "user.email", "a@b.invalid"], { cwd: repo, env });
  execFileSync("git", ["config", "user.name", "t"], { cwd: repo, env });
  mkdirSync(join(repo, "packages", "core"), { recursive: true });
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

  /*
   * Found by CI on Linux while macOS passed. A shell that runs `sleep` keeps it as a child, so killing the shell
   * leaves a grandchild alive holding the pipes open and nothing ever settles. Every real check spawns children —
   * that is what `npm test` is — so this hangs the gate forever, not just a test.
   *
   * The subshell is deliberate: it stops a shell from `exec`ing the sleep and becoming it, which is what hid this
   * on macOS in the first place.
   */
  it("kills a command's whole process tree, not just the shell at the top of it", async () => {
    const started = Date.now();
    const result = await runChecks({ cwd: repo, commands: ["( sleep 30 )"], timeoutMs: 300 });

    expect(result.ok).toBe(false);
    expect(result.summary).toContain("did not finish in time");
    expect(Date.now() - started).toBeLessThan(10_000);
  });

  it("kills a command that spawns several children of its own", async () => {
    const started = Date.now();
    const result = await runChecks({
      cwd: repo,
      commands: ["sleep 30 & sleep 30 & wait"],
      timeoutMs: 300,
    });

    expect(result.ok).toBe(false);
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

/*
 * Found by running the gate against a real agent's work rather than a fixture: a git worktree holds the tracked
 * files and nothing else, so `npm run test` in one answers `vitest: command not found` — which the gate would
 * have recorded as the project's checks failing.
 */
describe("dependencies a worktree does not have", () => {
  /** A real worktree of the repository, which is what the gate actually hands to `runChecks`. */
  const worktreeOf = (name: string): string => {
    const path = join(mkdtempSync(join(tmpdir(), "fanout-checks-wt-")), name);
    execFileSync("git", ["worktree", "add", "--detach", "--quiet", path, "HEAD"], { cwd: repo, env: gitEnv });
    return path;
  };

  it("lends them from the repository for the length of the check", async () => {
    mkdirSync(join(repo, "node_modules", ".bin"), { recursive: true });
    writeFileSync(join(repo, "node_modules", ".bin", "marker"), "here\n");
    const worktree = worktreeOf("lend");

    let sawMarker = false;
    await runChecks({
      cwd: worktree,
      repoRoot: repo,
      commands: ["true"],
      run: (_command, cwd) => {
        sawMarker = existsSync(join(cwd, "node_modules", ".bin", "marker"));
        return Promise.resolve({ exitCode: 0, output: "", timedOut: false });
      },
    });

    expect(sawMarker).toBe(true);
    rmSync(worktree, { recursive: true, force: true });
  });

  /*
   * Taken away again afterwards, and in a `finally`. An agent's sandbox may write anywhere in its worktree, and a
   * surviving link would put the developer's installed packages inside the one place an agent is allowed to write.
   */
  it("takes them away again, even when the check fails", async () => {
    mkdirSync(join(repo, "node_modules"), { recursive: true });
    const worktree = worktreeOf("fail");

    await runChecks({
      cwd: worktree,
      repoRoot: repo,
      commands: ["false"],
      run: () => Promise.resolve({ exitCode: 1, output: "nope", timedOut: false }),
    });

    expect(existsSync(join(worktree, "node_modules"))).toBe(false);
    rmSync(worktree, { recursive: true, force: true });
  });

  /*
   * A workspace puts a package's links inside that package. Lending only the root let 90 of 656 tests run — a
   * suite that looks like it ran and did not, which is the most expensive kind of green there is.
   */
  it("lends the ones nested inside packages, not only the one at the top", async () => {
    mkdirSync(join(repo, "node_modules"), { recursive: true });
    mkdirSync(join(repo, "packages", "core", "node_modules"), { recursive: true });
    writeFileSync(join(repo, "packages", "core", "node_modules", "linked"), "here\n");
    execFileSync("git", ["add", "-A"], { cwd: repo, env: gitEnv });
    execFileSync("git", ["commit", "--quiet", "-m", "packages"], { cwd: repo, env: gitEnv });
    const worktree = worktreeOf("nested");

    let saw = false;
    await runChecks({
      cwd: worktree,
      repoRoot: repo,
      commands: ["true"],
      run: (_command, cwd) => {
        saw = existsSync(join(cwd, "packages", "core", "node_modules", "linked"));
        return Promise.resolve({ exitCode: 0, output: "", timedOut: false });
      },
    });

    expect(saw).toBe(true);
    rmSync(worktree, { recursive: true, force: true });
  });

  it("never descends into a dependency directory looking for more", async () => {
    // `node_modules/foo/node_modules` is foo's business, and walking it would take all day.
    mkdirSync(join(repo, "node_modules", "foo", "node_modules"), { recursive: true });
    const worktree = worktreeOf("deep");

    // Checked from inside the run: by the time runChecks returns the links are gone, which is the point of them.
    const lent: string[] = [];
    await runChecks({
      cwd: worktree,
      repoRoot: repo,
      commands: ["true"],
      run: (_command, cwd) => {
        if (existsSync(join(cwd, "node_modules", "foo", "node_modules")))
          lent.push("reachable through the one link");
        if (lstatSync(join(cwd, "node_modules")).isSymbolicLink())
          lent.push("the top one is a link, not a copy");
        return Promise.resolve({ exitCode: 0, output: "", timedOut: false });
      },
    });

    expect(lent).toEqual(["reachable through the one link", "the top one is a link, not a copy"]);
    rmSync(worktree, { recursive: true, force: true });
  });

  it("leaves a worktree that already has its own alone", async () => {
    mkdirSync(join(repo, "node_modules"), { recursive: true });
    const worktree = worktreeOf("own");
    mkdirSync(join(worktree, "node_modules"), { recursive: true });
    writeFileSync(join(worktree, "node_modules", "its-own"), "mine\n");

    await runChecks({
      cwd: worktree,
      repoRoot: repo,
      commands: ["true"],
      run: () => Promise.resolve({ exitCode: 0, output: "", timedOut: false }),
    });

    expect(existsSync(join(worktree, "node_modules", "its-own"))).toBe(true);
    rmSync(worktree, { recursive: true, force: true });
  });
});
