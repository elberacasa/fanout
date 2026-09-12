import { copyFileSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { runChecks, type ChecksOptions, type ChecksResult } from "./checks.ts";
import { git } from "../workspace/git.ts";

/*
 * Proving that a fix fixes something.
 *
 * The fourth non-negotiable says a bug fix ships with a test that fails on the old code, and this is the only
 * part of the gate that cannot be satisfied by an agent being persuasive. A test that passes on the new code
 * proves the new code passes its own test. A test that *fails on the old code* proves the test is about the bug.
 *
 * So: build the old code again from the base commit, put only the run's new and changed tests on top of it, and
 * run the check. It has to fail. If it passes, the test would have passed before the fix, and whatever it is
 * testing is not what was broken.
 *
 * Everything here bends towards refusing. A proof we could not run is not a proof; a test file we could not
 * identify is not a proof; a check that errored for some unrelated reason is not a proof.
 */

/** Paths that look like tests. Documented rather than clever: a person has to be able to predict this. */
const TEST_PATH =
  /(^|\/)(tests?|__tests__|spec)\/|\.(test|spec)\.[cm]?[jt]sx?$|_test\.(py|go|rb)$|(^|\/)test_[^/]+\.py$/;

export function looksLikeATest(path: string): boolean {
  return TEST_PATH.test(path);
}

export interface ProofOptions {
  /** The repository the run started from. */
  repoRoot: string;
  /** The worktree holding the agent's changes. */
  workspacePath: string;
  /** The commit the run started from: the old code. */
  baseCommit: string;
  /** Every path the run touched, repo-relative. */
  touched: readonly string[];
  /** The line's own checks. A proof runs the project's real command, not one we invent. */
  commands: readonly string[];
  timeoutMs?: number;
  runChecksImpl?: (options: ChecksOptions) => Promise<ChecksResult>;
}

export interface ProofResult {
  ok: boolean;
  /** The tests that were put on the old code. Empty when none could be identified. */
  tests: string[];
  /** Named so a reader knows what was proven, and so `proof.done` can carry them. */
  failedOnOld: string[];
  why: string;
}

/**
 * Runs the run's new tests against the old code and insists they fail.
 *
 * The old code is a fresh worktree at the base commit — not the agent's worktree with changes reverted, because
 * "reverted" is a thing we would have to get exactly right and a checkout is a thing git gets right for us.
 */
export async function proveFix(options: ProofOptions): Promise<ProofResult> {
  const tests = options.touched.filter(looksLikeATest).sort();
  if (tests.length === 0) {
    return {
      ok: false,
      tests: [],
      failedOnOld: [],
      why: "this line is a fix but changed no file that looks like a test, so there is nothing to prove it with",
    };
  }
  if (options.commands.length === 0) {
    return {
      ok: false,
      tests,
      failedOnOld: [],
      why: "this line declares no checks, so there is no command that could run the test",
    };
  }

  const root = mkdtempSync(join(tmpdir(), "fanout-proof-"));
  const oldCode = join(root, "old");

  try {
    await git(["worktree", "add", "--detach", "--quiet", oldCode, options.baseCommit], {
      cwd: options.repoRoot,
    });

    // Only the tests travel. Bringing anything else would be bringing the fix, which is the whole point.
    for (const test of tests) {
      const destination = join(oldCode, test);
      mkdirSync(dirname(destination), { recursive: true });
      copyFileSync(join(options.workspacePath, test), destination);
    }

    const run = options.runChecksImpl ?? runChecks;
    const result = await run({
      cwd: oldCode,
      commands: options.commands,
      ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
    });

    /*
     * Failing is the passing outcome here, and it has to fail for the right reason. A command that could not
     * start at all tells us nothing about the bug: it is a broken proof, not a proven fix.
     */
    const couldNotRun = result.outcomes.some((outcome) => outcome.exitCode === null && !outcome.timedOut);
    if (couldNotRun) {
      return {
        ok: false,
        tests,
        failedOnOld: [],
        why: "the check could not run against the old code at all, so nothing was proven either way",
      };
    }

    if (result.ok) {
      return {
        ok: false,
        tests,
        failedOnOld: [],
        why: "the new tests pass on the old code, so they do not test what was broken",
      };
    }

    return {
      ok: true,
      tests,
      failedOnOld: tests,
      why: `the new tests fail on ${options.baseCommit.slice(0, 7)} and pass on this work`,
    };
  } catch (cause) {
    return {
      ok: false,
      tests,
      failedOnOld: [],
      why: `the old code could not be rebuilt to test against: ${cause instanceof Error ? cause.message : String(cause)}`,
    };
  } finally {
    await git(["worktree", "remove", "--force", oldCode], { cwd: options.repoRoot }).catch(() => undefined);
    rmSync(root, { recursive: true, force: true });
  }
}
