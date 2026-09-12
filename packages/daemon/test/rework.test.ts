import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Ledger, PlanGraph, type RunView, type SeatAdapter } from "@fanout/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MAX_REWORKS, reworkPrompt, reworkRun } from "../src/gate/rework.ts";

/*
 * Rework is worth more than a second attempt because the agent still holds its own reasoning about the code. Every
 * refusal below is a case where continuing would look like rework and not be one — and the expensive one is a seat
 * that cannot resume, where starting fresh would discard exactly the context the subscription was spent building.
 */

const LIMITS = {
  startTimeoutMs: 5_000,
  timeoutMs: 10_000,
  killGraceMs: 200,
  maxLogBytes: 1_000_000,
  maxLineBytes: 100_000,
};

let dir: string;
let ledger: Ledger;

const [line] = PlanGraph.parse({
  lines: [
    {
      id: "api",
      title: "CSV export",
      role: "builder",
      prompt: "Add GET /orders.csv.",
      seat: { id: "scripted" },
      scope: { write: ["src/**"] },
    },
  ],
}).lines;

/** An adapter that records how it was asked to start, and never actually runs anything interesting. */
function adapterThat(canResume: boolean): SeatAdapter & { asked: { sessionId?: string; prompt: string }[] } {
  const asked: { sessionId?: string; prompt: string }[] = [];
  const spec = (context: { workdir: string; baseEnv: Record<string, string> }) => ({
    argv: [process.execPath, "-e", "process.exit(0)"] as [string, ...string[]],
    cwd: context.workdir,
    env: context.baseEnv,
  });
  const adapter = {
    id: "scripted",
    asked,
    command: (context) => {
      asked.push({ prompt: context.line.prompt });
      return spec(context);
    },
    parse: () => ({ events: [], signals: [] }),
    ...(canResume
      ? {
          resume: (context) => {
            asked.push({ sessionId: context.sessionId, prompt: context.line.prompt });
            return spec(context);
          },
        }
      : {}),
  } as SeatAdapter & { asked: typeof asked };
  return adapter;
}

function run(overrides: Partial<RunView> = {}): RunView {
  return {
    runId: "api-1",
    lineId: "api",
    seat: { id: "scripted" },
    attempt: 1,
    status: "done",
    phase: "reporting",
    sessionId: "01a0-thread",
    workdir: null,
    movedFrom: null,
    lastTool: null,
    files: [],
    diffStat: null,
    exitCode: 0,
    usage: {},
    review: {
      verdict: "rework",
      notes: "escape the quotes in the header row too",
      by: { id: "claude" },
      revision: "a".repeat(64),
    },
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

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "fanout-rework-"));
  ledger = Ledger.open(":memory:");
  ledger.appendAll([
    {
      type: "mission.created",
      missionId: "m",
      goal: "g",
      repo: { root: dir, baseCommit: "0".repeat(40) },
      limits: { maxParallel: 1, timeoutMinutes: 10 },
    },
  ]);
});
afterEach(() => {
  ledger.close();
  rmSync(dir, { recursive: true, force: true });
});

const rework = (adapter: SeatAdapter, over: Partial<RunView> = {}) => {
  if (line === undefined) throw new Error("fixture");
  return reworkRun({
    ledger,
    adapter,
    missionId: "m",
    line,
    run: run(over),
    workspacePath: dir,
    runsRoot: join(dir, "runs"),
    limits: LIMITS,
  });
};

describe("sending a diff back to the agent that wrote it", () => {
  it("resumes the conversation, with the notes as the instruction", async () => {
    const adapter = adapterThat(true);
    const outcome = rework(adapter);

    expect(outcome.kind).toBe("started");
    if (outcome.kind === "started") {
      expect(outcome.runId).toBe("api-2");
      await outcome.active.finished;
    }
    expect(adapter.asked).toHaveLength(1);
    expect(adapter.asked[0]?.sessionId).toBe("01a0-thread");
    expect(adapter.asked[0]?.prompt).toContain("escape the quotes in the header row too");
  });

  it("does not repeat the original task, which would invite starting over", () => {
    const adapter = adapterThat(true);
    rework(adapter);
    expect(adapter.asked[0]?.prompt).not.toContain("Add GET /orders.csv");
  });

  it("works in the worktree the run already has", () => {
    const adapter = adapterThat(true);
    const outcome = rework(adapter);
    expect(outcome.kind).toBe("started");
    // A new worktree would show the agent its own code as if a stranger had written it.
    expect(adapter.asked).toHaveLength(1);
  });
});

describe("what it refuses", () => {
  it.each([
    ["there is no review", { review: null }],
    ["the review accepted it", { review: { ...run().review, verdict: "accept" as const } }],
    ["the review rejected it", { review: { ...run().review, verdict: "reject" as const } }],
    ["it is already merged", { status: "merged" as const }],
    ["it was dropped", { status: "dropped" as const }],
    ["the run never named its session", { sessionId: null }],
  ])("refuses when %s", (_label, overrides) => {
    const outcome = rework(adapterThat(true), overrides as Partial<RunView>);
    expect(outcome.kind).toBe("refused");
  });

  /*
   * The expensive one. Starting fresh while calling it rework spends the subscription and throws away the context
   * it was spent building, with nothing on screen to say so.
   */
  it("refuses a seat that cannot resume, rather than quietly starting over", () => {
    const outcome = rework(adapterThat(false));

    expect(outcome.kind).toBe("refused");
    if (outcome.kind === "refused") expect(outcome.why).toContain("cannot resume");
  });

  it("stops after two rounds and asks a person to decide", () => {
    const outcome = rework(adapterThat(true), { attempt: MAX_REWORKS + 1 });

    expect(outcome.kind).toBe("refused");
    if (outcome.kind === "refused") expect(outcome.why).toContain("decide what to do");
  });

  it("records nothing when it refuses", () => {
    const before = ledger.lastSeq();
    rework(adapterThat(false));
    expect(ledger.lastSeq()).toBe(before);
  });
});

describe("what the agent is told", () => {
  it("says what to change and what not to do", () => {
    const prompt = reworkPrompt("escape the quotes");
    expect(prompt).toContain("escape the quotes");
    expect(prompt).toContain("Do not start over");
    expect(prompt).toContain("do not commit");
  });
});
