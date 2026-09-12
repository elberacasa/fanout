import { describe, expect, it } from "vitest";
import {
  applyEvent,
  elapsedMs,
  silentMs,
  initialState,
  Ledger,
  project,
  type FanoutEventInput,
  type ProjectionState,
  type StoredEvent,
} from "../src/index.ts";
import { samples } from "./fixtures/events.ts";

const M = "csv-export";

const kimi = {
  ...samples["seat.detected"],
  seat: {
    ...samples["seat.detected"].seat,
    id: "kimi",
    displayName: "Kimi Code",
    binary: "kimi",
    version: "0.36.1",
    signedIn: "unknown",
  },
} satisfies FanoutEventInput;

/** A whole mission: an audit, a rerouted build that merges, and a docs run that times out and is dropped. */
const story: FanoutEventInput[] = [
  samples["seat.detected"],
  kimi,
  samples["mission.created"],
  samples["plan.proposed"],
  samples["safety.report"],
  {
    type: "run.queued",
    missionId: M,
    runId: "map-1",
    lineId: "map-export",
    seat: { id: "codex" },
    attempt: 1,
  },
  {
    type: "route.changed",
    missionId: M,
    lineId: "api-export",
    from: { id: "codex" },
    to: { id: "kimi" },
    reason: "Codex hit its 5-hour limit",
  },
  {
    type: "run.queued",
    missionId: M,
    runId: "api-1",
    lineId: "api-export",
    seat: { id: "kimi" },
    attempt: 1,
  },
  { type: "run.started", missionId: M, runId: "map-1", workdir: "/tmp/f/map-1", argv: ["codex", "exec"] },
  { type: "run.progress", missionId: M, runId: "map-1", phase: "reading" },
  { type: "run.tool", missionId: M, runId: "map-1", tool: "read", files: ["src/a.ts"] },
  {
    type: "run.usage",
    missionId: M,
    runId: "map-1",
    seat: "codex",
    amount: 2,
    unit: "messages",
    estimated: true,
  },
  { type: "run.finished", missionId: M, runId: "map-1", status: "done", exitCode: 0 },
  { type: "run.started", missionId: M, runId: "api-1", workdir: "/tmp/f/api-1", argv: ["kimi", "-p"] },
  { type: "run.progress", missionId: M, runId: "api-1", phase: "coding" },
  { type: "run.tool", missionId: M, runId: "api-1", tool: "edit", files: ["src/api/export/route.ts"] },
  {
    type: "run.tool",
    missionId: M,
    runId: "api-1",
    tool: "edit",
    summary: "add csv writer",
    files: ["src/api/export/csv.ts", "src/api/export/route.ts"],
  },
  {
    type: "run.usage",
    missionId: M,
    runId: "api-1",
    seat: "kimi",
    amount: 5,
    unit: "messages",
    estimated: false,
  },
  {
    type: "run.usage",
    missionId: M,
    runId: "api-1",
    seat: "kimi",
    amount: 1,
    unit: "messages",
    estimated: true,
  },
  {
    type: "run.finished",
    missionId: M,
    runId: "api-1",
    status: "done",
    exitCode: 0,
    diffStat: { files: 2, insertions: 84, deletions: 3 },
  },
  { ...samples["review.done"], runId: "api-1" },
  { ...samples["checks.done"], runId: "api-1" },
  { ...samples["proof.done"], runId: "api-1" },
  {
    type: "merge.applied",
    missionId: M,
    runId: "api-1",
    files: ["src/api/export/csv.ts", "src/api/export/route.ts"],
  },
  { type: "run.queued", missionId: M, runId: "docs-1", lineId: "docs", seat: { id: "codex" }, attempt: 1 },
  { type: "run.started", missionId: M, runId: "docs-1", workdir: "/tmp/f/docs-1", argv: ["codex", "exec"] },
  { type: "policy.breach", missionId: M, runId: "docs-1", limit: "timeoutMinutes", action: "killed" },
  { type: "run.finished", missionId: M, runId: "docs-1", status: "killed", exitCode: null },
  { type: "run.dropped", missionId: M, runId: "docs-1", reason: "Timed out; not needed for this mission" },
  { type: "mission.finished", missionId: M, outcome: "completed", summary: "1 merged · 1 dropped" },
];

function record(events: FanoutEventInput[]): StoredEvent[] {
  const ledger = Ledger.open(":memory:", { now: () => new Date("2026-09-11T17:00:00.000Z") });
  const stored = ledger.appendAll(events);
  ledger.close();
  return stored;
}

const events = record(story);

describe("project", () => {
  it("tells the story of a whole mission", () => {
    const state = project(events);
    const mission = state.missions[M];

    expect(state.anomalies).toEqual([]);
    expect(state.lastSeq).toBe(events.length);
    expect(Object.keys(state.crew)).toEqual(["codex", "kimi"]);
    expect(state.crew["kimi"]?.signedIn).toBe("unknown");

    expect(mission).toMatchObject({
      status: "finished",
      summary: "1 merged · 1 dropped",
      planRevision: 1,
      safety: { ok: true },
      runOrder: ["map-1", "api-1", "docs-1"],
      routes: [{ lineId: "api-export", to: { id: "kimi" }, reason: "Codex hit its 5-hour limit" }],
    });

    expect(mission?.runs["map-1"]).toMatchObject({
      status: "done",
      phase: "reading",
      files: ["src/a.ts"],
      exitCode: 0,
      usage: { messages: { amount: 2, estimated: true } },
    });

    expect(mission?.runs["api-1"]).toMatchObject({
      status: "merged",
      seat: { id: "kimi" },
      phase: "coding",
      lastTool: { tool: "edit", summary: "add csv writer" },
      files: ["src/api/export/csv.ts", "src/api/export/route.ts"],
      diffStat: { files: 2, insertions: 84, deletions: 3 },
      review: { verdict: "accept" },
      checks: { ok: true },
      proof: { ok: true, failedOnOld: ["export > escapes quotes"] },
      mergedFiles: ["src/api/export/csv.ts", "src/api/export/route.ts"],
    });

    expect(mission?.runs["docs-1"]).toMatchObject({
      status: "dropped",
      exitCode: null,
      breaches: [{ limit: "timeoutMinutes", action: "killed" }],
      dropReason: "Timed out; not needed for this mission",
    });

    expect(state.usage).toEqual({
      codex: { messages: { amount: 2, estimated: true } },
      kimi: { messages: { amount: 6, estimated: true } },
    });
  });

  it("gives the same state whether events arrive one by one or all at once", () => {
    const whole = project(events);
    for (let split = 0; split <= events.length; split += 1) {
      const resumed = project(events.slice(split), project(events.slice(0, split)));
      expect(resumed).toEqual(whole);
    }
    expect(events.reduce(applyEvent, initialState())).toEqual(whole);
  });

  it("never mutates a previous state", () => {
    let state = deepFreeze(initialState());
    for (const event of events) {
      const before = JSON.stringify(state);
      const next = applyEvent(state, event);
      expect(JSON.stringify(state)).toBe(before);
      state = deepFreeze(next);
    }
  });

  it("clears the safety report when the plan changes", () => {
    const revised = record([
      samples["mission.created"],
      samples["plan.proposed"],
      samples["safety.report"],
      samples["plan.revised"],
    ]);
    const mission = project(revised).missions[M];
    expect(mission?.planRevision).toBe(2);
    expect(mission?.safety).toBeNull();
  });

  it("refuses a safety report that belongs to an older plan", () => {
    const state = project(
      record([
        samples["mission.created"],
        samples["plan.proposed"],
        samples["plan.revised"],
        samples["safety.report"],
      ]),
    );
    const mission = state.missions[M];
    expect(mission?.planRevision).toBe(2);
    expect(mission?.safety).toBeNull();
    expect(state.anomalies).toEqual([
      {
        seq: 4,
        type: "safety.report",
        message: "safety report is for plan revision 1, but the mission is at revision 2",
      },
    ]);
  });

  it("keeps a safety report that matches the current plan", () => {
    const state = project(
      record([
        samples["mission.created"],
        samples["plan.proposed"],
        samples["plan.revised"],
        { ...samples["safety.report"], planRevision: 2 },
      ]),
    );
    expect(state.anomalies).toEqual([]);
    expect(state.missions[M]?.safety).toMatchObject({ ok: true, planRevision: 2 });
  });

  it("records events that don't fit as anomalies instead of crashing", () => {
    const odd = record([
      samples["run.progress"],
      samples["mission.created"],
      samples["mission.created"],
      samples["run.queued"],
      samples["run.queued"],
      { ...samples["run.usage"], runId: "ghost-1" },
    ]);
    const state = project(odd);
    expect(state.anomalies.map((anomaly) => anomaly.message)).toEqual([
      'unknown mission "csv-export"',
      'mission "csv-export" already exists',
      'run "api-export-1" already exists',
      'unknown run "ghost-1" in mission "csv-export"',
    ]);
    expect(state.usage).toEqual({});
    expect(state.lastSeq).toBe(odd.length);
  });

  it("treats ids that collide with object properties as ordinary ids", () => {
    const state = project(
      record([
        { ...samples["mission.created"], missionId: "constructor" },
        { ...samples["run.queued"], missionId: "constructor", runId: "constructor" },
      ]),
    );
    const tricky = "constructor";
    expect(state.anomalies).toEqual([]);
    expect(state.missions[tricky]?.runs[tricky]).toMatchObject({ runId: tricky, status: "queued" });
  });

  it("records an event for an unknown mission named like an object property", () => {
    const state = project(record([{ ...samples["run.progress"], missionId: "constructor" }]));
    expect(state.anomalies).toEqual([
      { seq: 1, type: "run.progress", message: 'unknown mission "constructor"' },
    ]);
  });

  it.each(["merge.applied", "run.dropped"] as const)("does not bring a run back after %s", (terminal) => {
    const state = project(
      record([
        samples["mission.created"],
        samples["run.queued"],
        samples["run.started"],
        samples["run.finished"],
        samples[terminal],
        samples["run.started"],
        samples["run.finished"],
      ]),
    );
    const run = state.missions[M]?.runs["api-export-1"];
    expect(run?.status).toBe(terminal === "merge.applied" ? "merged" : "dropped");
    expect(state.anomalies).toHaveLength(2);
  });

  it("refuses usage charged to a seat other than the run's", () => {
    const state = project(
      record([
        samples["mission.created"],
        samples["run.queued"],
        samples["run.started"],
        { ...samples["run.usage"], seat: "kimi" },
      ]),
    );
    expect(state.anomalies).toHaveLength(1);
    expect(state.usage).toEqual({});
    expect(state.missions[M]?.runs["api-export-1"]?.usage).toEqual({});
  });

  it("ignores an event whose sequence number goes backwards", () => {
    const state = project(events.slice(0, 5));
    const replayed = events[2];
    if (replayed === undefined) throw new Error("fixture too short");
    const after = applyEvent(state, replayed);
    expect(after.lastSeq).toBe(5);
    expect(after.missions).toEqual(state.missions);
    expect(after.anomalies).toEqual([
      { seq: 3, type: "mission.created", message: "sequence 3 arrived after 5; ignored" },
    ]);
  });
});

/*
 * A run that is slow must not look like a run that is stuck. The ledger already stamps every event, so the
 * projection keeps the three moments that matter and the reader does the arithmetic against its own clock —
 * a stored "6m 38s" would be a lie the instant it was read.
 */
describe("run timing", () => {
  const clock = (...isoTimes: string[]): (() => Date) => {
    let i = 0;
    return () => new Date(isoTimes[Math.min(i++, isoTimes.length - 1)] ?? "");
  };

  const timed = (now: () => Date, inputs: FanoutEventInput[]): StoredEvent[] => {
    const ledger = Ledger.open(":memory:", { now });
    const stored = ledger.appendAll(inputs);
    ledger.close();
    return stored;
  };

  const upTo = (index: number): FanoutEventInput[] =>
    [
      samples["mission.created"],
      { type: "run.queued", missionId: M, runId: "r1", lineId: "l1", seat: { id: "codex" }, attempt: 1 },
      { type: "run.started", missionId: M, runId: "r1", workdir: "/tmp/f/r1", argv: ["codex", "exec"] },
      { type: "run.finished", missionId: M, runId: "r1", status: "done", exitCode: 0 },
    ].slice(0, index) as FanoutEventInput[];

  it("records when a run was queued, started and ended", () => {
    const state = project(
      timed(
        clock(
          "2026-09-12T10:00:00.000Z",
          "2026-09-12T10:00:05.000Z",
          "2026-09-12T10:00:11.000Z",
          "2026-09-12T10:06:49.000Z",
        ),
        upTo(4),
      ),
    );

    expect(state.missions[M]?.runs["r1"]).toMatchObject({
      queuedAt: "2026-09-12T10:00:05.000Z",
      startedAt: "2026-09-12T10:00:11.000Z",
      endedAt: "2026-09-12T10:06:49.000Z",
    });
  });

  it("measures a finished run between its own two stamps, not against the clock", () => {
    const state = project(
      timed(
        clock(
          "2026-09-12T10:00:00.000Z",
          "2026-09-12T10:00:05.000Z",
          "2026-09-12T10:00:11.000Z",
          "2026-09-12T10:06:49.000Z",
        ),
        upTo(4),
      ),
    );
    const run = state.missions[M]?.runs["r1"];
    if (run === undefined) throw new Error("no run");

    // An hour later the answer is the same: the run took 6m 38s and always will have.
    expect(elapsedMs(run, new Date("2026-09-12T11:00:00.000Z"))).toBe(398_000);
  });

  it("measures a running run against now, so a slow run visibly grows", () => {
    const state = project(
      timed(
        clock("2026-09-12T10:00:00.000Z", "2026-09-12T10:00:05.000Z", "2026-09-12T10:00:11.000Z"),
        upTo(3),
      ),
    );
    const run = state.missions[M]?.runs["r1"];
    if (run === undefined) throw new Error("no run");

    expect(run.endedAt).toBeNull();
    expect(elapsedMs(run, new Date("2026-09-12T10:02:11.000Z"))).toBe(120_000);
    expect(elapsedMs(run, new Date("2026-09-12T10:15:11.000Z"))).toBe(900_000);
  });

  /*
   * The landing mission's Grok line sat on "reading" for fifteen minutes. Elapsed time alone does not separate a
   * thinking agent from a dead one — only the gap since its last sign of life does.
   */
  it("tells a working run from a silent one by when it last said anything", () => {
    const talking = [
      samples["mission.created"],
      { type: "run.queued", missionId: M, runId: "r1", lineId: "l1", seat: { id: "codex" }, attempt: 1 },
      { type: "run.started", missionId: M, runId: "r1", workdir: "/tmp/f/r1", argv: ["codex", "exec"] },
      { type: "run.progress", missionId: M, runId: "r1", phase: "coding" },
    ] satisfies FanoutEventInput[];

    const state = project(
      timed(
        clock(
          "2026-09-12T10:00:00.000Z",
          "2026-09-12T10:00:05.000Z",
          "2026-09-12T10:00:11.000Z",
          "2026-09-12T10:04:00.000Z",
        ),
        talking,
      ),
    );
    const run = state.missions[M]?.runs["r1"];
    if (run === undefined) throw new Error("no run");

    expect(run.updatedAt).toBe("2026-09-12T10:04:00.000Z");
    // Four minutes in, and it spoke nine seconds ago: slow, not stuck.
    expect(elapsedMs(run, new Date("2026-09-12T10:04:09.000Z"))).toBe(238_000);
    expect(silentMs(run, new Date("2026-09-12T10:04:09.000Z"))).toBe(9_000);
    // Six minutes later it has said nothing at all, and that is the number worth showing.
    expect(silentMs(run, new Date("2026-09-12T10:10:00.000Z"))).toBe(360_000);
  });

  it("reports no silence for a run that has already ended", () => {
    const state = project(
      timed(
        clock(
          "2026-09-12T10:00:00.000Z",
          "2026-09-12T10:00:05.000Z",
          "2026-09-12T10:00:11.000Z",
          "2026-09-12T10:06:49.000Z",
        ),
        upTo(4),
      ),
    );
    const run = state.missions[M]?.runs["r1"];
    if (run === undefined) throw new Error("no run");

    expect(silentMs(run, new Date("2026-09-12T18:00:00.000Z"))).toBeNull();
  });

  it("does not call a queued run silent, since it has not been launched yet", () => {
    const state = project(timed(clock("2026-09-12T10:00:00.000Z", "2026-09-12T10:00:05.000Z"), upTo(2)));
    const run = state.missions[M]?.runs["r1"];
    if (run === undefined) throw new Error("no run");

    // Half an hour in a queue is the scheduler working, not an agent that has stopped talking.
    expect(silentMs(run, new Date("2026-09-12T10:30:00.000Z"))).toBeNull();
  });

  it("says nothing rather than zero for a run that has not started", () => {
    const state = project(timed(clock("2026-09-12T10:00:00.000Z", "2026-09-12T10:00:05.000Z"), upTo(2)));
    const run = state.missions[M]?.runs["r1"];
    if (run === undefined) throw new Error("no run");

    expect(run.startedAt).toBeNull();
    expect(elapsedMs(run, new Date("2026-09-12T10:30:00.000Z"))).toBeNull();
  });

  it("never reports negative time when the clock moves backwards", () => {
    const state = project(
      timed(
        clock("2026-09-12T10:00:00.000Z", "2026-09-12T10:00:05.000Z", "2026-09-12T10:00:11.000Z"),
        upTo(3),
      ),
    );
    const run = state.missions[M]?.runs["r1"];
    if (run === undefined) throw new Error("no run");

    expect(elapsedMs(run, new Date("2026-09-12T09:00:00.000Z"))).toBe(0);
  });
});

function deepFreeze(state: ProjectionState): ProjectionState {
  const freeze = (value: unknown): void => {
    if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
      Object.freeze(value);
      Object.values(value).forEach(freeze);
    }
  };
  freeze(state);
  return state;
}
