import { PlanGraph, type ClaimCheck, type MissionView, type RunView } from "@fanout/core";
import { describe, expect, it } from "vitest";
import { ownWorkOwed, unfinishedReport, whatIsOwed } from "../src/unfinished.ts";

/*
 * The Stop hook's question: is the lead about to walk away from work that nobody has reviewed?
 *
 * It exists because the lead's real failure is not disagreeing with the gate — it is never asking it, or believing
 * its own work is finished. A hook runs whether or not anyone remembered it.
 */

const REV = "a1".repeat(32);

const plan = PlanGraph.parse({
  lines: [
    {
      id: "api",
      title: "CSV export",
      role: "builder",
      prompt: "Add it.",
      seat: { id: "codex" },
      scope: { write: ["src/api/**"] },
    },
    {
      id: "date",
      title: "Fix the date bug",
      role: "builder",
      prompt: "Fix it.",
      seat: { id: "codex" },
      scope: { write: ["src/date/**"] },
      fixesBug: true,
    },
  ],
});

function run(runId: string, lineId: string, overrides: Partial<RunView> = {}): RunView {
  return {
    runId,
    lineId,
    seat: { id: "codex" },
    attempt: 1,
    status: "done",
    phase: "reporting",
    lastTool: null,
    files: [],
    diffStat: null,
    exitCode: 0,
    usage: {},
    review: null,
    checks: null,
    proof: null,
    approval: null,
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

function mission(...runs: RunView[]): MissionView {
  return {
    missionId: "csv-export",
    goal: "Add CSV export",
    repo: { root: "/work", baseCommit: "0".repeat(40) },
    limits: { maxParallel: 2, timeoutMinutes: 30 },
    status: "running",
    plan,
    planRevision: 1,
    safety: null,
    runs: Object.fromEntries(runs.map((r) => [r.runId, r])),
    runOrder: runs.map((r) => r.runId),
    routes: [],
    summary: null,
    createdSeq: 1,
    updatedSeq: 9,
  };
}

describe("what is owed", () => {
  it("names a finished run nobody has reviewed", () => {
    const owed = whatIsOwed([mission(run("api-1", "api"))]);
    expect(owed).toEqual([
      { missionId: "csv-export", runId: "api-1", what: "Nobody has reviewed this diff." },
    ]);
  });

  it("names a fix that arrived without its proof", () => {
    const reviewed = run("date-1", "date", {
      review: { verdict: "accept", notes: "looks right", by: { id: "claude" }, revision: REV },
      checks: { ok: true, summary: "green", commands: ["npm run check"], revision: REV },
      approval: { by: { kind: "user" }, revision: REV, note: null },
    });
    expect(whatIsOwed([mission(reviewed)])[0]?.what).toContain("fail on the old code");
  });

  it.each([
    ["still running", "running" as const],
    ["queued", "queued" as const],
    ["already merged", "merged" as const],
    ["dropped on purpose", "dropped" as const],
  ])("says nothing about a run that is %s", (_label, status) => {
    expect(whatIsOwed([mission(run("api-1", "api", { status }))])).toEqual([]);
  });

  it("says nothing when everything finished has been settled", () => {
    expect(whatIsOwed([mission(run("api-1", "api", { status: "merged" }))])).toEqual([]);
  });

  it("does not crash on a run whose plan line has gone", () => {
    const orphan = whatIsOwed([mission(run("ghost-1", "no-such-line"))]);
    expect(orphan[0]?.what).toContain("plan line is missing");
  });
});

describe("what the hook prints", () => {
  it("stays completely silent when nothing is owed", () => {
    // A hook that speaks on every turn is a hook people turn off.
    expect(unfinishedReport([])).toBe("");
  });

  it("says what is waiting, and that nothing was merged behind the owner's back", () => {
    const report = unfinishedReport(whatIsOwed([mission(run("api-1", "api"), run("date-1", "date"))]));
    expect(report).toContain("2 runs still waiting on you");
    expect(report).toContain("api-1");
    expect(report).toContain("date-1");
    expect(report).toContain("Nothing has been merged");
  });

  it("counts one run in the singular, because small things signal care", () => {
    expect(unfinishedReport(whatIsOwed([mission(run("api-1", "api"))]))).toContain("1 run still waiting");
  });
});

/*
 * The lead's own changes, which are where most of a session's code comes from and where it gets exactly one
 * reader. A check nobody is reminded of is a check nobody runs.
 */
describe("what the lead's own work owes", () => {
  const REV = "a1".repeat(32);
  const OLD = "b2".repeat(32);

  const checked = (over: Partial<ClaimCheck> = {}): ClaimCheck => ({
    revision: REV,
    by: { id: "codex" },
    claims: [{ claim: "no behaviour change", verdict: "confirmed", evidence: "checked" }],
    ran: true,
    simulated: false,
    at: "2026-09-12T12:00:00.000Z",
    ...over,
  });

  it("says nothing at all when the tree is clean", () => {
    expect(ownWorkOwed({ revision: REV, files: 0, checked: undefined })).toBe("");
  });

  it("says nothing when the current work has been checked and nothing was refuted", () => {
    expect(ownWorkOwed({ revision: REV, files: 3, checked: checked() })).toBe("");
  });

  it("points out changes nobody but the author has read", () => {
    const said = ownWorkOwed({ revision: REV, files: 3, checked: undefined });
    expect(said).toContain("3 changed files");
    expect(said).toContain("nobody but you has read them");
    expect(said).toContain("fanout check");
  });

  it("does not let a check of older bytes stand for these ones", () => {
    const said = ownWorkOwed({ revision: REV, files: 2, checked: checked({ revision: OLD }) });
    expect(said).toContain("moved since the last check");
  });

  it("does not let a check that failed to run stand for a clean one", () => {
    expect(ownWorkOwed({ revision: REV, files: 1, checked: checked({ ran: false }) })).toContain(
      "could not run",
    );
  });

  it("repeats a refuted claim, with the reason, until it is dealt with", () => {
    const said = ownWorkOwed({
      revision: REV,
      files: 1,
      checked: checked({
        claims: [
          { claim: "no secrets reach the reviewer", verdict: "refuted", evidence: "a symlink escapes" },
          { claim: "tests cover it", verdict: "confirmed", evidence: "they do" },
        ],
      }),
    });
    expect(said).toContain("no secrets reach the reviewer");
    expect(said).toContain("a symlink escapes");
    expect(said).not.toContain("tests cover it");
  });

  it("counts one file in the singular", () => {
    expect(ownWorkOwed({ revision: REV, files: 1, checked: undefined })).toContain("1 changed file,");
  });
});
