import type { PlanLine } from "../schema/plan.ts";
import type { RunView } from "../projections/state.ts";

/*
 * Whether a piece of work may be merged, and if not, exactly what is missing.
 *
 * This is the smallest and most important function in the product. Everything else — worktrees, adapters, the
 * ledger, the mission view — exists so that this can be asked honestly about a specific diff. It is a pure
 * function of recorded facts on purpose: it cannot read a file, run a command, or be talked round by an agent's
 * account of its own work, and a replay of the ledger reaches the same verdict months later.
 *
 * The rule it enforces is one sentence: nothing merges that review, checks, proof and a person did not all agree
 * on, about the *same revision*. Each of those is easy alone. Tying them to one revision is the part that makes
 * "reviewed and checked" mean something, because a worktree can change between being judged and being applied.
 */

export type BlockerCode =
  | "not-finished"
  | "already-settled"
  | "no-review"
  | "review-rejected"
  | "review-asked-for-rework"
  | "review-stale"
  | "no-checks"
  | "checks-failed"
  | "checks-stale"
  | "no-proof"
  | "proof-failed"
  | "proof-stale"
  | "not-approved"
  | "approval-stale";

export interface Blocker {
  code: BlockerCode;
  /** Written for the person who has to do something about it, not for a log. */
  message: string;
}

export interface Readiness {
  ready: boolean;
  /** Empty when ready. Ordered the way a person would work through them. */
  blockers: Blocker[];
}

/**
 * Can `run`'s work at `revision` be merged?
 *
 * `line` is the plan line the run came from: it says whether a proof is required, which is a decision made when
 * the mission was planned rather than after an agent has explained why its change is obviously fine.
 */
export function mergeReadiness(run: RunView, line: PlanLine, revision: string): Readiness {
  const blockers: Blocker[] = [];
  const add = (code: BlockerCode, message: string): void => {
    blockers.push({ code, message });
  };

  // A run that is already merged or dropped is not a candidate; a second merge would double-apply its diff.
  if (run.status === "merged" || run.status === "dropped" || run.status === "conflict") {
    add("already-settled", `This run is already ${run.status}.`);
    return { ready: false, blockers };
  }
  if (run.status !== "done") {
    add("not-finished", `The agent has not finished: the run is ${run.status}.`);
  }

  if (run.review === null) {
    add("no-review", "Nobody has reviewed this diff.");
  } else if (run.review.verdict === "reject") {
    add("review-rejected", "Review rejected this work.");
  } else if (run.review.verdict === "rework") {
    add("review-asked-for-rework", "Review asked for changes, which have not come back.");
  } else if (run.review.revision !== revision) {
    add("review-stale", staleMessage("review"));
  }

  if (run.checks === null) {
    add("no-checks", "The project's checks have not been run against this diff.");
  } else if (!run.checks.ok) {
    add("checks-failed", `The project's checks failed: ${run.checks.summary}`);
  } else if (run.checks.revision !== revision) {
    add("checks-stale", staleMessage("checks"));
  }

  /*
   * The fourth non-negotiable, in code. A fix without a test that fails on the old code is a claim that something
   * is fixed, and a claim is exactly what this gate exists not to accept. Only lines the plan marked as fixes are
   * held to it: demanding a failing-first test of a new feature would teach everyone to lie about the flag.
   */
  if (line.fixesBug) {
    if (run.proof === null) {
      add("no-proof", "This line fixes a bug, so it needs a test proven to fail on the old code.");
    } else if (!run.proof.ok) {
      add("proof-failed", "The new test did not fail on the old code, so it does not prove the fix.");
    } else if (run.proof.revision !== revision) {
      add("proof-stale", staleMessage("proof"));
    }
  }

  if (run.approval === null) {
    add("not-approved", "Nobody has approved this merge.");
  } else if (run.approval.revision !== revision) {
    add("approval-stale", staleMessage("approval"));
  }

  return { ready: blockers.length === 0, blockers };
}

/**
 * A stale step is not a failure, and saying "review failed" about one would send someone hunting for a problem
 * that is not there. The work moved after it was judged; it has to be judged again.
 */
function staleMessage(step: string): string {
  return `The work changed after ${step}, so ${step} was about a different diff. Run it again.`;
}

/** One line a person can read, for when the whole list is too much: the first thing standing in the way. */
export function firstBlocker(readiness: Readiness): string | null {
  return readiness.blockers[0]?.message ?? null;
}
