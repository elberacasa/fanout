import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createFakeAdapter, type ScenarioInput } from "fanout-adapter-fake";
import { Ledger, PlanGraph, project, type AdapterContext, type AdapterSignal } from "fanout-core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { baseEnv } from "../src/env.ts";
import { startRun, type RunLimits } from "../src/run.ts";

/*
 * Milestone 2 end to end: the fake seat's real CLI, launched by the real supervisor through the run glue, recorded in
 * a real ledger, read back through the projections.
 */

const MISSION = "demo";
const RUN = "api-1";
const LIMITS: RunLimits = {
  startTimeoutMs: 5000,
  timeoutMs: 10_000,
  killGraceMs: 300,
  maxLogBytes: 1_000_000,
  maxLineBytes: 100_000,
};

const [line] = PlanGraph.parse({
  lines: [
    {
      id: "api",
      title: "CSV endpoint",
      role: "builder",
      prompt: "Add the CSV endpoint.",
      seat: { id: "fake" },
      scope: { write: ["src/**"] },
    },
  ],
}).lines;
if (line === undefined) throw new Error("fixture plan has no line");

let dir: string;
let ledger: Ledger;
let context: AdapterContext;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "fanout-e2e-"));
  const workdir = join(dir, "worktree");
  mkdirSync(workdir);
  ledger = Ledger.open(join(dir, "ledger.db"));
  ledger.appendAll([
    {
      type: "mission.created",
      missionId: MISSION,
      goal: "Add CSV export",
      repo: { root: dir, baseCommit: "0".repeat(40) },
      limits: { maxParallel: 2, timeoutMinutes: 5 },
    },
    { type: "run.queued", missionId: MISSION, runId: RUN, lineId: "api", seat: { id: "fake" }, attempt: 1 },
  ]);
  context = {
    missionId: MISSION,
    runId: RUN,
    line,
    workdir,
    reportPath: join(dir, "runs", RUN, "report.md"),
    baseEnv: baseEnv(),
  };
});

afterEach(() => {
  ledger.close();
  rmSync(dir, { recursive: true, force: true });
});

function launch(scenario: ScenarioInput, limits: Partial<RunLimits> = {}) {
  const signals: AdapterSignal[] = [];
  const run = startRun({
    ledger,
    adapter: createFakeAdapter({ scenarioFor: () => ({ timeScale: 0, ...scenario }) }),
    context,
    logPath: join(dir, "runs", RUN, "run.log"),
    limits: { ...LIMITS, ...limits },
    onSignal: (signal) => signals.push(signal),
  });
  return { run, signals };
}

function runView() {
  const state = project(ledger.read());
  expect(state.anomalies).toEqual([]);
  return state.missions[MISSION]?.runs[RUN];
}

describe("fake seat through the supervisor", () => {
  it("runs a mission line end to end", async () => {
    const { run, signals } = launch({
      steps: [
        { phase: "reading" },
        { tool: "edit", summary: "add csv writer", write: { "src/api/csv.ts": "export const csv = 1;\n" } },
        { usage: 3 },
        { phase: "testing" },
      ],
      report: "Added the endpoint.",
    });

    expect(await run.finished).toMatchObject({ status: "done", exitCode: 0, startDetected: true });
    expect(signals).toEqual([{ kind: "report", text: "Added the endpoint." }]);
    expect(readFileSync(join(context.workdir, "src/api/csv.ts"), "utf8")).toBe("export const csv = 1;\n");
    expect(readFileSync(context.reportPath, "utf8")).toBe("Added the endpoint.");
    expect(existsSync(join(dir, "runs", RUN, "run.log"))).toBe(true);
    expect(runView()).toMatchObject({
      status: "done",
      phase: "testing",
      files: ["src/api/csv.ts"],
      lastTool: { tool: "edit", summary: "add csv writer" },
      usage: { messages: { amount: 3, estimated: false } },
    });
    expect(ledger.read().at(-1)).toMatchObject({ type: "run.finished", reportPath: context.reportPath });
  });

  it("passes on the limit signal when the seat runs out of usage", async () => {
    const { run, signals } = launch({
      steps: [{ phase: "coding" }, { limit: "usage limit reached" }],
      report: "Out of usage.",
    });

    expect(await run.finished).toMatchObject({ status: "failed", exitCode: 2 });
    expect(signals).toContainEqual({ kind: "limit", message: "usage limit reached" });
    expect(runView()).toMatchObject({ status: "failed", exitCode: 2 });
  });

  it("stops a run that hangs past its time limit", async () => {
    const { run } = launch({ steps: [{ phase: "coding" }], report: "", hang: true }, { timeoutMs: 800 });

    expect(await run.finished).toMatchObject({ status: "timeout" });
    expect(runView()).toMatchObject({ status: "timeout" });
  });

  it("kills a run on request", async () => {
    const { run } = launch({ steps: [{ phase: "coding" }], report: "", hang: true });
    await new Promise((resolve) => setTimeout(resolve, 400));

    expect(await run.handle.kill("the lead dropped this line")).toMatchObject({ status: "killed" });
    expect(await run.finished).toMatchObject({ status: "killed" });
    expect(runView()).toMatchObject({ status: "killed" });
  });
});
