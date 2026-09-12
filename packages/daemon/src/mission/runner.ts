import { mkdirSync } from "node:fs";
import { join } from "node:path";
import {
  validatePlan,
  type AdapterSignal,
  type Ledger,
  type PlanGraph,
  type PlanLine,
  type SeatAdapter,
} from "@fanout/core";
import { baseEnv } from "../env.ts";
import { startRun, type RunLimits } from "../run.ts";
import type { RunExitStatus } from "../supervisor/types.ts";
import type { Workspace, WorkspaceManager } from "../workspace/types.ts";

/*
 * A plan becomes runs here. The rules it keeps are the ones a person would expect and a machine forgets:
 *
 *   - a line starts only when every line it depends on has finished well;
 *   - a line whose dependency failed is dropped with the reason, never started hopefully;
 *   - no more lines run at once than the mission allows;
 *   - every run gets its own workspace, and the workspace stays afterwards so the diff can be reviewed;
 *   - an invalid plan never runs at all.
 *
 * It records what happens as events. It does not review, merge or reroute: those are the gate's job, and a runner
 * that quietly merged would be the most dangerous code in the project.
 */

export interface MissionRunnerOptions {
  ledger: Ledger;
  workspaces: WorkspaceManager;
  /** Seat id to the adapter that drives it. A line whose seat is missing is dropped, not guessed at. */
  adapters: ReadonlyMap<string, SeatAdapter>;
  /** Run logs and reports live under `<runsRoot>/<missionId>/<runId>/`. */
  runsRoot: string;
  limits: RunLimits;
  onSignal?: (runId: string, signal: AdapterSignal) => void;
}

export interface LaunchRequest {
  missionId: string;
  plan: PlanGraph;
  baseCommit: string;
  maxParallel: number;
}

export interface RunOutcome {
  runId: string;
  lineId: string;
  status: RunExitStatus | "dropped";
  workspace: Workspace | null;
  reason?: string;
}

export interface MissionOutcome {
  missionId: string;
  runs: RunOutcome[];
  done: number;
  failed: number;
  dropped: number;
}

export interface MissionHandle {
  readonly missionId: string;
  readonly finished: Promise<MissionOutcome>;
  /** Stops everything still running. The mission finishes with those runs marked killed. */
  cancel(reason: string): Promise<void>;
}

/** A plan that does not pass its own validation never becomes runs. */
export class PlanRefused extends Error {
  override name = "PlanRefused";
  readonly issues: readonly { code: string; message: string; lineIds: string[] }[];

  constructor(issues: readonly { code: string; message: string; lineIds: string[] }[]) {
    super(`This plan cannot run:\n${issues.map((issue) => `  - ${issue.message}`).join("\n")}`);
    this.issues = issues;
  }
}

export function createMissionRunner(options: MissionRunnerOptions) {
  return {
    launch(request: LaunchRequest): MissionHandle {
      const issues = validatePlan(request.plan);
      if (issues.length > 0) throw new PlanRefused(issues);
      return run(options, request);
    },
  };
}

function run(options: MissionRunnerOptions, request: LaunchRequest): MissionHandle {
  const { ledger, workspaces, adapters, limits } = options;
  const byId = new Map(request.plan.lines.map((line) => [line.id, line]));
  const waiting = new Set(byId.keys());
  const outcomes = new Map<string, RunOutcome>();
  const active = new Map<string, { kill: (reason: string) => Promise<unknown>; settled: Promise<void> }>();
  let cancelling: string | undefined;

  const finishedWell = (lineId: string): boolean => outcomes.get(lineId)?.status === "done";
  const finishedBadly = (lineId: string): boolean => {
    const status = outcomes.get(lineId)?.status;
    return status !== undefined && status !== "done";
  };

  const drop = (line: PlanLine, reason: string): void => {
    const runId = runIdFor(line);
    ledger.append({
      type: "run.queued",
      missionId: request.missionId,
      runId,
      lineId: line.id,
      seat: line.seat,
      attempt: 1,
    });
    ledger.append({ type: "run.dropped", missionId: request.missionId, runId, reason });
    outcomes.set(line.id, { runId, lineId: line.id, status: "dropped", workspace: null, reason });
    waiting.delete(line.id);
  };

  const start = async (line: PlanLine): Promise<void> => {
    const runId = runIdFor(line);
    const adapter = adapters.get(line.seat.id);
    if (adapter === undefined) {
      drop(line, `no adapter is installed for the seat "${line.seat.id}"`);
      return;
    }

    waiting.delete(line.id);
    ledger.append({
      type: "run.queued",
      missionId: request.missionId,
      runId,
      lineId: line.id,
      seat: line.seat,
      attempt: 1,
    });

    const directory = join(options.runsRoot, request.missionId, runId);
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    const workspace = await workspaces.create({
      missionId: request.missionId,
      runId,
      baseCommit: request.baseCommit,
      line,
    });

    const started = startRun({
      ledger,
      adapter,
      context: {
        missionId: request.missionId,
        runId,
        line,
        workdir: workspace.path,
        reportPath: join(directory, "report.md"),
        baseEnv: baseEnv(),
      },
      logPath: join(directory, "run.log"),
      limits,
      collectDiff: async () => (await workspaces.collect(workspace, line)).stat,
      ...(options.onSignal === undefined
        ? {}
        : { onSignal: (signal: AdapterSignal) => options.onSignal?.(runId, signal) }),
    });

    const settled = started.finished
      .then((exit) => {
        outcomes.set(line.id, { runId, lineId: line.id, status: exit.status, workspace });
      })
      .catch((error: unknown) => {
        outcomes.set(line.id, {
          runId,
          lineId: line.id,
          status: "failed",
          workspace,
          reason: error instanceof Error ? error.message : "the run could not be recorded",
        });
      })
      .finally(() => {
        active.delete(line.id);
      });

    active.set(line.id, { kill: (reason) => started.handle.kill(reason), settled });
  };

  const finished = (async (): Promise<MissionOutcome> => {
    while (waiting.size > 0 || active.size > 0) {
      for (const lineId of [...waiting]) {
        const line = byId.get(lineId);
        if (line === undefined) continue;
        if (cancelling !== undefined) {
          drop(line, cancelling);
          continue;
        }
        if (line.dependsOn.some(finishedBadly)) {
          const blocker = line.dependsOn.find(finishedBadly) ?? "a line it depends on";
          drop(line, `"${blocker}" did not finish, so this line was not started`);
          continue;
        }
        if (active.size >= request.maxParallel) break;
        if (line.dependsOn.every(finishedWell)) await start(line);
      }

      if (active.size > 0) await Promise.race([...active.values()].map((entry) => entry.settled));
      else if (waiting.size > 0 && [...waiting].every((id) => !ready(id, byId, finishedWell))) {
        // Nothing can start and nothing is running: whatever is left is waiting on something that never happened.
        for (const lineId of [...waiting]) {
          const line = byId.get(lineId);
          if (line !== undefined) drop(line, "the lines it depends on never finished");
        }
      }
    }

    const runs = [...outcomes.values()];
    return {
      missionId: request.missionId,
      runs,
      done: runs.filter((outcome) => outcome.status === "done").length,
      failed: runs.filter((outcome) => outcome.status !== "done" && outcome.status !== "dropped").length,
      dropped: runs.filter((outcome) => outcome.status === "dropped").length,
    };
  })();

  return {
    missionId: request.missionId,
    finished,
    async cancel(reason: string): Promise<void> {
      cancelling = reason;
      await Promise.all([...active.values()].map((entry) => entry.kill(reason)));
    },
  };
}

function ready(lineId: string, byId: Map<string, PlanLine>, finishedWell: (id: string) => boolean): boolean {
  return byId.get(lineId)?.dependsOn.every(finishedWell) ?? false;
}

/** One attempt per line for now; rework (attempt 2 and 3) arrives with the merge gate. */
function runIdFor(line: PlanLine): string {
  return `${line.id}-1`;
}
