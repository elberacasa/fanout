import { describe, expect, it } from "vitest";
import { firstBlocker, mergeReadiness, PlanGraph, type PlanLine, type RunView } from "../src/index.ts";

/*
 * The gate's whole judgement. These tests are the specification of the fourth non-negotiable: nothing merges that
 * review, checks, proof and a person did not all agree on, about the same revision.
 */

const REV = "a1".repeat(32);
const OTHER = "b2".repeat(32);

function onlyLine(input: Record<string, unknown>): PlanLine {
  const [parsed] = PlanGraph.parse({ lines: [input] }).lines;
  if (parsed === undefined) throw new Error("a one-line plan has one line");
  return parsed;
}

const feature = onlyLine({
  id: "api",
  title: "CSV export",
  role: "builder",
  prompt: "Add it.",
  seat: { id: "codex" },
  scope: { write: ["src/api/**"] },
});

const fix = onlyLine({
  id: "api",
  title: "Fix the date bug",
  role: "builder",
  prompt: "Fix it.",
  seat: { id: "codex" },
  scope: { write: ["src/api/**"] },
  fixesBug: true,
});

/** The parts of a ready run the tests bend one at a time. */
const READY = {
  review: { verdict: "accept" as const, notes: "good", by: { id: "claude" }, revision: REV },
  checks: { ok: true, summary: "12 pass", commands: ["npm run check"], revision: REV },
  approval: { by: { kind: "user" as const }, revision: REV, note: null },
};

function run(overrides: Partial<RunView> = {}): RunView {
  return {
    runId: "api-1",
    lineId: "api",
    seat: { id: "codex" },
    attempt: 1,
    status: "done",
    phase: "reporting",
    lastTool: null,
    files: ["src/api/export.ts"],
    diffStat: { files: 1, insertions: 10, deletions: 1 },
    exitCode: 0,
    usage: {},
    review: READY.review,
    checks: READY.checks,
    proof: null,
    approval: READY.approval,
    merged: null,
    mergedFiles: [],
    conflictFiles: [],
    dropReason: null,
    breaches: [],
    queuedSeq: 1,
    startedSeq: 2,
    updatedSeq: 3,
    queuedAt: "2026-09-12T10:00:00.000Z",
    startedAt: "2026-09-12T10:00:01.000Z",
    endedAt: "2026-09-12T10:03:00.000Z",
    updatedAt: "2026-09-12T10:03:00.000Z",
    ...overrides,
  };
}

const codes = (r: RunView, line: PlanLine = feature, revision = REV): string[] =>
  mergeReadiness(r, line, revision).blockers.map((blocker) => blocker.code);

describe("what the gate lets through", () => {
  it("allows a reviewed, checked and approved feature", () => {
    expect(mergeReadiness(run(), feature, REV)).toEqual({ ready: true, blockers: [] });
  });

  it("allows a fix that came with a test proven to fail on the old code", () => {
    const proven = run({ proof: { ok: true, failedOnOld: ["date > parses"], revision: REV } });
    expect(mergeReadiness(proven, fix, REV).ready).toBe(true);
  });
});

describe("what the gate stops", () => {
  it.each([
    ["no review at all", { review: null }, "no-review"],
    ["a rejected review", { review: { ...READY.review, verdict: "reject" as const } }, "review-rejected"],
    [
      "a review asking for rework",
      { review: { ...READY.review, verdict: "rework" as const } },
      "review-asked-for-rework",
    ],
    ["no checks", { checks: null }, "no-checks"],
    ["failing checks", { checks: { ...READY.checks, ok: false } }, "checks-failed"],
    ["nobody's approval", { approval: null }, "not-approved"],
    ["an agent that has not finished", { status: "running" as const }, "not-finished"],
  ])("stops %s", (_label, overrides, code) => {
    expect(codes(run(overrides))).toContain(code);
  });

  /*
   * The fourth non-negotiable. A fix without a failing-first test is a claim that something is fixed, and a claim
   * is precisely what this gate exists not to accept.
   */
  it("will not merge a declared bug fix with no proof", () => {
    expect(codes(run(), fix)).toEqual(["no-proof"]);
  });

  it("will not merge a fix whose test did not fail on the old code", () => {
    const unproven = run({ proof: { ok: false, failedOnOld: [], revision: REV } });
    expect(codes(unproven, fix)).toEqual(["proof-failed"]);
  });

  it("does not demand a proof of work that is not a fix", () => {
    // Asking every line for a failing-first test would teach everyone to lie about the flag.
    expect(codes(run(), feature)).toEqual([]);
  });
});

/*
 * The reason the whole contract carries a revision. Each of these steps really happened and really passed — about
 * a different diff. Treating them as current is the one failure that would make the gate theatre.
 */
describe("work that changed after it was judged", () => {
  it.each([
    ["review", { review: { ...READY.review, revision: OTHER } }, "review-stale"],
    ["checks", { checks: { ...READY.checks, revision: OTHER } }, "checks-stale"],
    ["approval", { approval: { ...READY.approval, revision: OTHER } }, "approval-stale"],
  ])("refuses when %s was about an earlier revision", (_label, overrides, code) => {
    expect(codes(run(overrides))).toEqual([code]);
  });

  it("refuses a proof that was about an earlier revision", () => {
    const stale = run({ proof: { ok: true, failedOnOld: ["date > parses"], revision: OTHER } });
    expect(codes(stale, fix)).toEqual(["proof-stale"]);
  });

  it("says the work changed rather than blaming the step that passed", () => {
    const stale = run({ checks: { ...READY.checks, revision: OTHER } });
    const message = firstBlocker(mergeReadiness(stale, feature, REV)) ?? "";
    expect(message).toContain("changed after");
    expect(message).not.toContain("failed");
  });
});

describe("work that is already settled", () => {
  it.each(["merged", "dropped", "conflict"] as const)("will not merge a %s run a second time", (status) => {
    const settled = run({ status });
    expect(mergeReadiness(settled, feature, REV)).toMatchObject({
      ready: false,
      blockers: [{ code: "already-settled" }],
    });
  });
});

describe("telling someone what to do", () => {
  it("lists everything missing, not just the first thing", () => {
    expect(codes(run({ review: null, checks: null, approval: null }))).toEqual([
      "no-review",
      "no-checks",
      "not-approved",
    ]);
  });

  it("has nothing to say when the work is ready", () => {
    expect(firstBlocker(mergeReadiness(run(), feature, REV))).toBeNull();
  });
});
