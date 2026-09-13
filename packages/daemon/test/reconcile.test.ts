import { Ledger, project } from "fanout-core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { reconcile } from "../src/mission/reconcile.ts";

/*
 * The failure this exists for, found by using the product rather than reading it.
 *
 * A `/fanout` mission was launched from a Claude Code session, the session ended while the agent was still
 * working, and the run stayed recorded as `running` — for eleven minutes, and then for good. The supervisor
 * lives inside that session's MCP server, so this is not an edge case: it is what happens every time somebody
 * closes their terminal.
 */

const M = "demo";
let ledger: Ledger;

beforeEach(() => {
  ledger = Ledger.open(":memory:");
  ledger.appendAll([
    {
      type: "mission.created",
      missionId: M,
      goal: "Fix the discount bug",
      repo: { root: "/work", baseCommit: "0".repeat(40) },
      limits: { maxParallel: 2, timeoutMinutes: 30 },
    },
    { type: "run.queued", missionId: M, runId: "api-1", lineId: "api", seat: { id: "codex" }, attempt: 1 },
  ]);
});

afterEach(() => {
  ledger.close();
});

/** A pid that is certainly not running: allocated, freed, and never reused inside one test. */
const DEAD = 2_147_483_646;

const runOf = (runId: string) => project(ledger.read()).missions[M]?.runs[runId];

describe("runs whose supervisor is gone", () => {
  it("ends a run whose owner has died, and says why", () => {
    ledger.append({
      type: "run.started",
      missionId: M,
      runId: "api-1",
      workdir: "/w",
      argv: ["codex"],
      owner: DEAD,
    });

    const { dropped } = reconcile(ledger);

    expect(dropped).toEqual(["api-1"]);
    expect(runOf("api-1")?.status).toBe("dropped");
    // The reason has to be actionable: "dropped" alone sends someone looking for a bug that is not there.
    expect(runOf("api-1")?.dropReason).toContain("nothing was watching");
  });

  /*
   * The most dangerous mistake this could make. A second terminal is an ordinary thing, and ending its runs
   * because this process did not start them would break the case the feature is supposed to protect.
   */
  it("leaves alone a run whose supervisor is still alive", () => {
    ledger.append({
      type: "run.started",
      missionId: M,
      runId: "api-1",
      workdir: "/w",
      argv: ["codex"],
      owner: process.pid,
    });

    expect(reconcile(ledger, 999_999).dropped).toEqual([]);
    expect(runOf("api-1")?.status).toBe("running");
  });

  it("ends a queued run in an abandoned mission, which never got an owner to check", () => {
    const { dropped } = reconcile(ledger);

    expect(dropped).toEqual(["api-1"]);
    expect(runOf("api-1")?.dropReason).toContain("the session that started this run ended");
  });

  it("closes the mission too, so it stops reading as in flight", () => {
    ledger.append({
      type: "run.started",
      missionId: M,
      runId: "api-1",
      workdir: "/w",
      argv: ["codex"],
      owner: DEAD,
    });

    reconcile(ledger);

    expect(project(ledger.read()).missions[M]?.status).toBe("aborted");
  });

  /*
   * Seen for real: a daemon restarted after its runs had completed, and the mission read
   * `running · 1 waiting for review` indefinitely. Nothing had dropped, so nothing closed it — the process that
   * held the handle had died between the last run finishing and the finish being written.
   */
  it("closes a mission whose runs all settled, even when it dropped nothing", () => {
    ledger.appendAll([
      {
        type: "run.started",
        missionId: M,
        runId: "api-1",
        workdir: "/w",
        argv: ["codex"],
        owner: process.pid,
      },
      { type: "run.finished", missionId: M, runId: "api-1", status: "done", exitCode: 0 },
    ]);

    const { dropped } = reconcile(ledger);

    expect(dropped).toEqual([]);
    const mission = project(ledger.read()).missions[M];
    expect(mission?.status).toBe("finished");
    // "completed", not "aborted": nothing went wrong, the record was simply never closed.
    expect(mission?.summary).toContain("nothing recorded the mission as over");
  });

  it("leaves a mission alone while one of its runs is still going", () => {
    ledger.appendAll([
      {
        type: "run.started",
        missionId: M,
        runId: "api-1",
        workdir: "/w",
        argv: ["codex"],
        owner: process.pid,
      },
    ]);

    reconcile(ledger);

    expect(project(ledger.read()).missions[M]?.status).toBe("running");
  });

  it("says nothing about a run that already finished", () => {
    ledger.appendAll([
      { type: "run.started", missionId: M, runId: "api-1", workdir: "/w", argv: ["codex"], owner: DEAD },
      { type: "run.finished", missionId: M, runId: "api-1", status: "done", exitCode: 0 },
    ]);

    expect(reconcile(ledger).dropped).toEqual([]);
    expect(runOf("api-1")?.status).toBe("done");
  });

  it("is safe to run twice, because a daemon starts more than once", () => {
    ledger.append({
      type: "run.started",
      missionId: M,
      runId: "api-1",
      workdir: "/w",
      argv: ["codex"],
      owner: DEAD,
    });

    reconcile(ledger);
    const after = ledger.read().length;

    expect(reconcile(ledger).dropped).toEqual([]);
    expect(ledger.read()).toHaveLength(after);
  });
});
