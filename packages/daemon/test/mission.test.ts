import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { createFakeAdapter, type ScenarioInput } from "@fanout/adapter-fake";
import { Ledger, PlanGraph, project, type SeatAdapter, type StoredEvent } from "@fanout/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createMissionRunner, PlanRefused, type MissionRunnerOptions } from "../src/mission/runner.ts";
import { createWorkspaceManager } from "../src/workspace/manager.ts";

/*
 * A plan becoming runs, driven by the real fake-seat CLI in real git worktrees. Nothing here is mocked: the point
 * is to find out what happens when a dependency fails, when two lines want to run at once, and when someone
 * changes their mind halfway through.
 */

const MISSION = "csv-export";
const LIMITS: MissionRunnerOptions["limits"] = {
  startTimeoutMs: 10_000,
  timeoutMs: 30_000,
  killGraceMs: 300,
  maxLogBytes: 1_000_000,
  maxLineBytes: 100_000,
};

let dir: string;
let repo: string;
let baseCommit: string;
let ledger: Ledger;
let scenarios: Map<string, ScenarioInput>;
let adapter: SeatAdapter;

const gitEnv = {
  PATH: process.env["PATH"] ?? "",
  HOME: process.env["HOME"] ?? "",
  GIT_CONFIG_NOSYSTEM: "1",
  LC_ALL: "C",
};

function git(args: string[]): string {
  return execFileSync("git", args, { cwd: repo, encoding: "utf8", env: gitEnv });
}

function plan(lines: Record<string, unknown>[]): PlanGraph {
  return PlanGraph.parse({ lines });
}

function line(id: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id,
    title: id,
    role: "builder",
    prompt: `Do ${id}.`,
    seat: { id: "fake" },
    scope: { write: [`src/${id}/**`] },
    ...overrides,
  };
}

function runner(overrides: Partial<MissionRunnerOptions> = {}) {
  return createMissionRunner({
    ledger,
    workspaces: createWorkspaceManager({ repoRoot: repo, workspaceRoot: join(dir, "workspaces") }),
    adapters: new Map([["fake", adapter]]),
    runsRoot: join(dir, "runs"),
    limits: LIMITS,
    ...overrides,
  });
}

const writes = (id: string): ScenarioInput => ({
  steps: [
    { phase: "coding" },
    { tool: "edit", write: { [`src/${id}/made.ts`]: `export const ${id} = 1;\n` } },
  ],
  report: `${id} done`,
  timeScale: 0,
});

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "fanout-mission-"));
  repo = join(dir, "repo");
  mkdirSync(repo);
  git(["init", "--quiet", "-b", "main"]);
  git(["config", "user.email", "crew@example.invalid"]);
  git(["config", "user.name", "Fanout tests"]);
  const seed = join(repo, "README.md");
  mkdirSync(dirname(seed), { recursive: true });
  writeFileSync(seed, "# sample\n");
  git(["add", "-A"]);
  git(["commit", "--quiet", "-m", "seed"]);
  baseCommit = git(["rev-parse", "HEAD"]).trim();

  ledger = Ledger.open(":memory:");
  ledger.append({
    type: "mission.created",
    missionId: MISSION,
    goal: "Add CSV export",
    repo: { root: repo, baseCommit },
    limits: { maxParallel: 2, timeoutMinutes: 5 },
  });

  scenarios = new Map();
  adapter = createFakeAdapter({
    scenarioFor: (planLine) => scenarios.get(planLine.id) ?? writes(planLine.id),
  });
});

afterEach(() => {
  ledger.close();
  rmSync(dir, { recursive: true, force: true });
});

const types = (events: StoredEvent[]): string[] => events.map((event) => event.type);

describe("running a plan", () => {
  it("runs each line in its own worktree, in dependency order", async () => {
    const mission = runner().launch({
      missionId: MISSION,
      plan: plan([line("api"), line("ui"), line("tests", { dependsOn: ["api"] })]),
      baseCommit,
      maxParallel: 2,
    });

    const outcome = await mission.finished;
    expect(outcome).toMatchObject({ done: 3, failed: 0, dropped: 0 });

    for (const run of outcome.runs) {
      expect(run.workspace).not.toBeNull();
      const written = join(run.workspace?.path ?? "", `src/${run.lineId}/made.ts`);
      expect(readFileSync(written, "utf8")).toContain(run.lineId);
    }

    const state = project(ledger.read());
    expect(state.anomalies).toEqual([]);
    const runs = state.missions[MISSION]?.runs ?? {};
    expect(Object.keys(runs).sort()).toEqual(["api-1", "tests-1", "ui-1"]);
    expect(runs["api-1"]).toMatchObject({ status: "done", files: ["src/api/made.ts"] });
    expect(runs["api-1"]?.diffStat?.files).toBe(1);

    // The dependent line cannot have started before the line it waits for finished.
    const events = ledger.read();
    const apiFinished = events.findIndex((event) => event.type === "run.finished" && event.runId === "api-1");
    const testsQueued = events.findIndex((event) => event.type === "run.queued" && event.runId === "tests-1");
    expect(testsQueued).toBeGreaterThan(apiFinished);
  });

  it("drops a line whose dependency failed, with the reason, and never starts it", async () => {
    scenarios.set("api", { steps: [{ phase: "coding" }], report: "broke", exitCode: 1, timeScale: 0 });

    const outcome = await runner().launch({
      missionId: MISSION,
      plan: plan([line("api"), line("tests", { dependsOn: ["api"] })]),
      baseCommit,
      maxParallel: 2,
    }).finished;

    expect(outcome).toMatchObject({ done: 0, failed: 1, dropped: 1 });
    const dropped = outcome.runs.find((run) => run.status === "dropped");
    expect(dropped?.reason).toContain("api");
    expect(types(ledger.read())).toContain("run.dropped");
    expect(ledger.read().some((event) => event.type === "run.started" && event.runId === "tests-1")).toBe(
      false,
    );
  });

  it("runs no more at once than the mission allows", async () => {
    scenarios.set("api", { ...writes("api"), steps: [{ sleep: 400 }, ...writes("api").steps], timeScale: 1 });

    await runner().launch({
      missionId: MISSION,
      plan: plan([line("api"), line("ui")]),
      baseCommit,
      maxParallel: 1,
    }).finished;

    const events = ledger.read();
    const firstFinished = events.findIndex((event) => event.type === "run.finished");
    const secondQueued = events.findLastIndex((event) => event.type === "run.queued");
    expect(secondQueued).toBeGreaterThan(firstFinished);
  });

  it("refuses a plan that cannot run, before recording anything", () => {
    const before = ledger.lastSeq();
    expect(() =>
      runner().launch({
        missionId: MISSION,
        plan: plan([
          line("api", { scope: { write: ["src/**"] } }),
          line("ui", { scope: { write: ["src/ui/**"] } }),
        ]),
        baseCommit,
        maxParallel: 2,
      }),
    ).toThrow(PlanRefused);
    expect(ledger.lastSeq()).toBe(before);
  });

  it("drops a line whose seat nobody can drive", async () => {
    const outcome = await runner().launch({
      missionId: MISSION,
      plan: plan([line("api", { seat: { id: "kimi" } })]),
      baseCommit,
      maxParallel: 2,
    }).finished;

    expect(outcome.dropped).toBe(1);
    expect(outcome.runs[0]?.reason).toContain("kimi");
  });

  it("stops everything when the mission is cancelled", async () => {
    scenarios.set("api", { steps: [{ phase: "coding" }], report: "", hang: true, timeScale: 0 });
    const mission = runner().launch({
      missionId: MISSION,
      plan: plan([line("api"), line("ui", { dependsOn: ["api"] })]),
      baseCommit,
      maxParallel: 1,
    });

    await new Promise((resolve) => setTimeout(resolve, 500));
    await mission.cancel("the owner changed their mind");
    const outcome = await mission.finished;

    expect(outcome.runs.find((run) => run.lineId === "api")?.status).toBe("killed");
    expect(outcome.runs.find((run) => run.lineId === "ui")?.reason).toContain("changed their mind");
    expect(existsSync(join(dir, "runs", MISSION, "api-1", "run.log"))).toBe(true);
  });
});
