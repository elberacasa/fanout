import { join } from "node:path";
import type { Ledger, PlanLine, RunView, SeatAdapter } from "fanout-core";
import { baseEnv } from "../env.ts";
import { startRun, type ActiveRun, type RunLimits } from "../run.ts";

/*
 * Sending a diff back to the agent that wrote it.
 *
 * The whole value is in the word "back". The agent still holds its own reasoning about this code, so a note
 * saying "escape the quotes in the header row too" lands on someone who knows which header row, what it was
 * weighed against, and why the first attempt looked right. A fresh run handed a summary of that reasoning is a
 * stranger reading a description of a conversation it was not in — and it is charged at the same rate.
 *
 * It is also the same worktree, so the agent sees the code it wrote and the notes about it together rather than
 * being asked to imagine both.
 */

/** Two rounds, then a person decides. */
export const MAX_REWORKS = 2;

export interface ReworkOptions {
  ledger: Ledger;
  adapter: SeatAdapter;
  missionId: string;
  line: PlanLine;
  run: RunView;
  /** The worktree the run already has. Rework never creates a new one. */
  workspacePath: string;
  runsRoot: string;
  limits: RunLimits;
}

export type ReworkOutcome =
  { kind: "started"; runId: string; active: ActiveRun } | { kind: "refused"; why: string };

/**
 * Starts the next turn of the conversation that produced this diff, with the reviewer's notes as the instruction.
 *
 * Every refusal here is a case where continuing would look like rework and not be one. The most important is a
 * seat that cannot resume: starting fresh while calling it rework would spend a subscription to discard exactly
 * the context the subscription was spent building, with nothing on screen to say so.
 */
export function reworkRun(options: ReworkOptions): ReworkOutcome {
  const { run, line } = options;

  const review = run.review;
  if (review?.verdict !== "rework") {
    return { kind: "refused", why: "rework needs a review that asked for it, with the notes to send back" };
  }
  if (run.status === "merged" || run.status === "dropped") {
    return { kind: "refused", why: `this run is already ${run.status}` };
  }
  if (run.sessionId === null) {
    return {
      kind: "refused",
      why: "this run never told us its session, so there is no conversation to continue",
    };
  }
  if (options.adapter.resume === undefined) {
    return {
      kind: "refused",
      why: `${options.adapter.id} cannot resume a session, so this work cannot be sent back to the agent that wrote it`,
    };
  }
  if (run.attempt > MAX_REWORKS) {
    /*
     * A third attempt is a signal about the task, not about the agent. Rework is for a diff that is nearly right;
     * work that has come back twice needs a person to look at the plan rather than another round of notes.
     */
    return {
      kind: "refused",
      why: `this line has already been reworked ${String(run.attempt - 1)} times; decide what to do with it instead`,
    };
  }

  const attempt = run.attempt + 1;
  const runId = `${line.id}-${String(attempt)}`;
  const directory = join(options.runsRoot, options.missionId, runId);

  options.ledger.appendAll([
    { type: "run.queued", missionId: options.missionId, runId, lineId: line.id, seat: run.seat, attempt },
  ]);

  const active = startRun({
    ledger: options.ledger,
    adapter: options.adapter,
    context: {
      missionId: options.missionId,
      runId,
      /*
       * The notes are the instruction, not the original task. The session already holds the task; repeating it
       * would invite the agent to start again instead of reading what it got wrong.
       */
      line: { ...line, prompt: reworkPrompt(review.notes) },
      workdir: options.workspacePath,
      reportPath: join(directory, "report.md"),
      baseEnv: baseEnv(),
      sessionId: run.sessionId,
    },
    logPath: join(directory, "run.log"),
    limits: options.limits,
    resumeSession: run.sessionId,
  });

  return { kind: "started", runId, active };
}

/**
 * What the agent is told.
 *
 * Short on purpose. It is already in the conversation and already has the code in front of it; the one thing it
 * does not have is what a reader thought when they read it.
 */
export function reworkPrompt(notes: string): string {
  return [
    "Your work was reviewed and needs changes. The notes are below.",
    "",
    "Change only what they ask for, in the same files you already have open. Do not start over, do not commit,",
    "and do not widen the scope you were given.",
    "",
    notes,
  ].join("\n");
}
