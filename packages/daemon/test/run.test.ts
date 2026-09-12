import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  Ledger,
  PlanGraph,
  project,
  type AdapterContext,
  type AdapterSignal,
  type FanoutEventInput,
  type ParseResult,
  type SeatAdapter,
} from "@fanout/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { baseEnv } from "../src/env.ts";
import { startRun, type RunLimits } from "../src/run.ts";

const MISSION = "demo";
const RUN = "api-1";
const LIMITS: RunLimits = {
  startTimeoutMs: 5000,
  timeoutMs: 10_000,
  killGraceMs: 200,
  maxLogBytes: 1_000_000,
  maxLineBytes: 100_000,
};

const [line] = PlanGraph.parse({
  lines: [
    {
      id: "api",
      title: "API",
      role: "builder",
      prompt: "Build it.",
      seat: { id: "scripted" },
      scope: { write: ["src/**"] },
    },
  ],
}).lines;
if (line === undefined) throw new Error("fixture plan has no line");

/**
 * A stand-in adapter: the "CLI" is a Node script that prints the given lines. Lines that start with "{" are events;
 * "report: …" becomes a report signal; anything else is unparsed.
 */
function scripted(
  output: string[],
  options: { exitCode?: number; writeReport?: boolean; sleepMs?: number; stderr?: string[] } = {},
) {
  const program = [
    `const fs = require("node:fs");`,
    `for (const line of ${JSON.stringify(options.stderr ?? [])}) process.stderr.write(line + "\\n");`,
    `for (const line of ${JSON.stringify(output)}) console.log(line);`,
    options.writeReport === true ? `fs.writeFileSync(process.argv[1], "done");` : "",
    options.sleepMs === undefined ? "" : `setTimeout(() => {}, ${options.sleepMs});`,
    `process.exitCode = ${options.exitCode ?? 0};`,
  ].join("\n");

  const adapter: SeatAdapter = {
    id: "scripted",
    command: (context) => ({
      argv: [process.execPath, "-e", program, context.reportPath],
      cwd: context.workdir,
      env: context.baseEnv,
    }),
    parse: (text): ParseResult => {
      if (text.startsWith("{")) return { events: [JSON.parse(text) as FanoutEventInput], signals: [] };
      if (text.startsWith("report: "))
        return { events: [], signals: [{ kind: "report", text: text.slice(8) }] };
      if (text.startsWith("session: "))
        return { events: [], signals: [{ kind: "session", id: text.slice(9) }] };
      return { events: [], signals: [{ kind: "unparsed", line: text }] };
    },
    parseStderr: (text): ParseResult =>
      text.includes("usage limit")
        ? { events: [], signals: [{ kind: "limit", message: text }] }
        : { events: [], signals: [] },
  };
  return adapter;
}

const event = (value: Record<string, unknown>) =>
  JSON.stringify({ missionId: MISSION, runId: RUN, ...value });

let dir: string;
let ledger: Ledger;
let context: AdapterContext;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "fanout-run-"));
  ledger = Ledger.open(join(dir, "ledger.db"));
  ledger.appendAll([
    {
      type: "mission.created",
      missionId: MISSION,
      goal: "Demo",
      repo: { root: dir, baseCommit: "0".repeat(40) },
      limits: { maxParallel: 2, timeoutMinutes: 5 },
    },
    {
      type: "run.queued",
      missionId: MISSION,
      runId: RUN,
      lineId: "api",
      seat: { id: "scripted" },
      attempt: 1,
    },
  ]);
  context = {
    missionId: MISSION,
    runId: RUN,
    line,
    workdir: dir,
    reportPath: join(dir, "report.md"),
    baseEnv: baseEnv(),
  };
});

afterEach(() => {
  try {
    ledger.close();
  } catch {
    // already closed by the test
  }
  rmSync(dir, { recursive: true, force: true });
});

function typesOf(events: { type: string }[]): string[] {
  return events.map((stored) => stored.type);
}

describe("startRun", () => {
  it("records a run from start to finish and passes signals on in order", async () => {
    const signals: AdapterSignal[] = [];
    const run = startRun({
      ledger,
      adapter: scripted([
        event({ type: "run.progress", phase: "coding" }),
        event({ type: "run.tool", tool: "edit", files: ["src/a.ts"] }),
        event({ type: "run.usage", seat: "scripted", amount: 2, unit: "messages", estimated: false }),
        "report: all done",
      ]),
      context,
      logPath: join(dir, "run.log"),
      limits: LIMITS,
      onSignal: (signal) => signals.push(signal),
    });

    const exit = await run.finished;
    expect(exit.status).toBe("done");
    expect(signals).toEqual([{ kind: "report", text: "all done" }]);
    expect(typesOf(ledger.read())).toEqual([
      "mission.created",
      "run.queued",
      "run.started",
      "run.progress",
      "run.tool",
      "run.usage",
      "run.finished",
    ]);
    const state = project(ledger.read());
    expect(state.anomalies).toEqual([]);
    expect(state.missions[MISSION]?.runs[RUN]).toMatchObject({
      status: "done",
      phase: "coding",
      files: ["src/a.ts"],
      exitCode: 0,
    });
  });

  it("refuses events an adapter must not emit, and says so", async () => {
    const signals: AdapterSignal[] = [];
    const foreign = JSON.stringify({
      type: "run.progress",
      missionId: MISSION,
      runId: "other-1",
      phase: "coding",
    });
    const merge = event({ type: "merge.applied", files: ["src/a.ts"] });
    const invalid = event({ type: "run.progress", phase: "dreaming" });
    const run = startRun({
      ledger,
      adapter: scripted([foreign, merge, invalid, event({ type: "run.progress", phase: "testing" })]),
      context,
      logPath: join(dir, "run.log"),
      limits: LIMITS,
      onSignal: (signal) => signals.push(signal),
    });

    await run.finished;
    expect(signals).toEqual([
      { kind: "unparsed", line: foreign },
      { kind: "unparsed", line: merge },
      { kind: "unparsed", line: invalid },
    ]);
    expect(typesOf(ledger.read())).toEqual([
      "mission.created",
      "run.queued",
      "run.started",
      "run.progress",
      "run.finished",
    ]);
  });

  it("hears a limit reported on stderr, where at least one real CLI puts it", async () => {
    const signals: AdapterSignal[] = [];
    const run = startRun({
      ledger,
      adapter: scripted([event({ type: "run.progress", phase: "coding" })], {
        exitCode: 1,
        stderr: ["warming up", "error: 403 You've reached your monthly usage limit for this billing cycle."],
      }),
      context,
      logPath: join(dir, "run.log"),
      limits: LIMITS,
      onSignal: (signal) => signals.push(signal),
    });

    expect((await run.finished).status).toBe("failed");
    expect(signals).toEqual([
      {
        kind: "limit",
        message: "error: 403 You've reached your monthly usage limit for this billing cycle.",
      },
    ]);
  });

  it("records a failing exit and the report when one was written", async () => {
    const run = startRun({
      ledger,
      adapter: scripted(["working"], { exitCode: 3, writeReport: true }),
      context,
      logPath: join(dir, "run.log"),
      limits: LIMITS,
    });

    expect((await run.finished).status).toBe("failed");
    expect(ledger.read().at(-1)).toMatchObject({
      type: "run.finished",
      status: "failed",
      exitCode: 3,
      reportPath: context.reportPath,
    });
  });

  it("stops the run when the ledger can no longer record it", async () => {
    const run = startRun({
      ledger,
      adapter: scripted(["started"], { sleepMs: 30_000 }),
      context,
      logPath: join(dir, "run.log"),
      limits: LIMITS,
    });
    ledger.close();

    const started = Date.now();
    await expect(run.finished).rejects.toThrow();
    expect(Date.now() - started).toBeLessThan(5000);
  });
});

/*
 * Rework replies into the session that wrote the diff rather than re-explaining the work to a stranger, so the
 * agent's name for that conversation has to be written down — and written down as soon as it is said, because the
 * run most likely to need rework is the one that ended badly.
 */
describe("remembering which conversation a run was", () => {
  it("records the session the moment the agent names it", async () => {
    const run = startRun({
      ledger,
      adapter: scripted(["session: 01a0-thread", event({ type: "run.progress", phase: "coding" })]),
      context,
      logPath: join(dir, "run.log"),
      limits: LIMITS,
    });
    await run.finished;

    expect(typesOf(ledger.read())).toContain("run.session");
    const projected = project(ledger.read()).missions[context.missionId]?.runs[context.runId];
    expect(projected?.sessionId).toBe("01a0-thread");
  });

  it("keeps it even when the run then fails, which is when rework matters most", async () => {
    const run = startRun({
      ledger,
      adapter: scripted(["session: 01a0-thread", "boom"], { exitCode: 1 }),
      context,
      logPath: join(dir, "run.log"),
      limits: LIMITS,
    });
    const exit = await run.finished;

    expect(exit.status).toBe("failed");
    expect(project(ledger.read()).missions[context.missionId]?.runs[context.runId]?.sessionId).toBe(
      "01a0-thread",
    );
  });

  it("says nothing rather than inventing one for a CLI that never names its session", async () => {
    const run = startRun({
      ledger,
      adapter: scripted([event({ type: "run.progress", phase: "coding" })]),
      context,
      logPath: join(dir, "run.log"),
      limits: LIMITS,
    });
    await run.finished;

    expect(project(ledger.read()).missions[context.missionId]?.runs[context.runId]?.sessionId).toBeNull();
  });
});
