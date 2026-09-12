import { existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import {
  InvalidEventError,
  type AdapterContext,
  type AdapterSignal,
  type DiffStat,
  type FanoutEventInput,
  type Ledger,
  type SeatAdapter,
} from "@fanout/core";
import { supervise } from "./supervisor/supervise.ts";
import type { RunExit, RunHandle, SuperviseOptions } from "./supervisor/types.ts";

/*
 * One run, end to end: the adapter builds the command, the supervisor runs it, the adapter reads its output, and the
 * ledger records what happened. Adapters may only report what their agent is doing (progress, tools, usage) for
 * their own run; anything else they emit is refused and surfaced as an `unparsed` signal.
 * If the ledger itself cannot record an event, the run is stopped: nothing runs unrecorded.
 */

export type RunLimits = Pick<
  SuperviseOptions,
  "startTimeoutMs" | "timeoutMs" | "killGraceMs" | "maxLogBytes" | "maxLineBytes"
>;

export interface StartRunOptions {
  ledger: Ledger;
  adapter: SeatAdapter;
  context: AdapterContext;
  logPath: string;
  limits: RunLimits;
  /** The adapter's hints (session id, limit reached, final report, unparsed lines), in order. */
  onSignal?: (signal: AdapterSignal) => void;
  /**
   * Read from the run's workspace once it has stopped, so `run.finished` carries what actually changed rather
   * than what the agent said it changed. Failing to read it never fails the run.
   */
  collectDiff?: () => Promise<DiffStat | undefined>;
  /**
   * Continue an earlier conversation instead of starting one.
   *
   * The run keeps the same worktree, so the agent sees the code it wrote and the notes about it together. Set
   * only when the seat can resume at all; `startRun` refuses rather than quietly starting over, because a rework
   * that silently forgot everything would spend a subscription to lose the context it was spent on.
   */
  resumeSession?: string;
}

/**
 * How this run is started: fresh, or as the next turn of a conversation that already exists.
 *
 * A seat asked to resume that cannot is an error rather than a fresh run. Rework's whole value is that the agent
 * still holds its own reasoning about the code, and silently discarding that while still charging for it is the
 * worst of both outcomes.
 */
function specFor(adapter: SeatAdapter, context: AdapterContext, sessionId?: string) {
  if (sessionId === undefined) return adapter.command(context);
  if (adapter.resume === undefined) {
    throw new Error(`${adapter.id} cannot resume a session, so this work cannot be reworked in place`);
  }
  return adapter.resume({ ...context, sessionId });
}

export interface ActiveRun {
  readonly handle: RunHandle;
  /** Resolves once `run.finished` is recorded; rejects only if the ledger failed. */
  readonly finished: Promise<RunExit>;
}

const ADAPTER_EVENT_TYPES: ReadonlySet<string> = new Set(["run.progress", "run.tool", "run.usage"]);

export function startRun(options: StartRunOptions): ActiveRun {
  const { ledger, adapter, context } = options;
  const ids = { missionId: context.missionId, runId: context.runId };
  const spec = specFor(adapter, context, options.resumeSession);

  // The run's own directories are the daemon's to make: the supervisor opens the log before it spawns anything,
  // and an agent should never have to create the place its report goes. Private to the user, like the ledger.
  mkdirSync(dirname(options.logPath), { recursive: true, mode: 0o700 });
  mkdirSync(dirname(context.reportPath), { recursive: true, mode: 0o700 });
  // Callbacks may fire before `supervise` returns, so they reach the handle through this holder.
  const control: { handle?: RunHandle } = {};
  let ledgerFailure: Error | undefined;

  const signal = (value: AdapterSignal): void => {
    /*
     * Written down the moment the agent names its conversation. Rework replies into the session that wrote the
     * diff rather than re-explaining the work to a stranger, and the run most likely to need rework is the one
     * that ended badly — so this cannot wait until the run finishes tidily.
     */
    if (value.kind === "session") {
      record({ type: "run.session", missionId: ids.missionId, runId: ids.runId, sessionId: value.id });
    }
    /*
     * A seat running out belongs to the account, not to this mission — the next mission needs to know as much as
     * this one does. Recorded here rather than left as a hint the runner may or may not act on, because a limit
     * nobody wrote down is a limit the crew rediscovers by spending on it again.
     */
    if (value.kind === "limit") {
      record({
        type: "seat.limited",
        seat: context.line.seat.id,
        message: value.message,
        ...(value.resetsAt === undefined ? {} : { resetsAt: value.resetsAt }),
      });
    }
    if (value.kind === "quota") {
      record({
        type: "seat.quota",
        seat: context.line.seat.id,
        window: value.window,
        utilization: value.utilization,
        ...(value.resetsAt === undefined ? {} : { resetsAt: value.resetsAt }),
      });
    }
    options.onSignal?.(value);
  };

  const record = (event: FanoutEventInput): boolean => {
    if (ledgerFailure !== undefined) return false;
    try {
      ledger.append(event);
      return true;
    } catch (error) {
      if (error instanceof InvalidEventError) return false;
      ledgerFailure = error instanceof Error ? error : new Error(String(error));
      void control.handle?.kill("the ledger could not record an event");
      return false;
    }
  };

  /** What went wrong with the ledger, if anything. A function so a caller's narrowing cannot go stale. */
  const ledgerBroke = (): Error | undefined => ledgerFailure;

  const belongsToRun = (event: FanoutEventInput): boolean =>
    ADAPTER_EVENT_TYPES.has(event.type) &&
    "runId" in event &&
    event.missionId === ids.missionId &&
    event.runId === ids.runId;

  const handle = supervise({
    runId: context.runId,
    spec,
    logPath: options.logPath,
    ...options.limits,
    onStarted: () => {
      record({ type: "run.started", ...ids, workdir: spec.cwd, argv: spec.argv });
    },
    onLine: (line, stream) => {
      const result =
        stream === "stdout" ? adapter.parse(line, context) : adapter.parseStderr?.(line, context);
      if (result === undefined) return;
      for (const event of result.events) {
        if (!belongsToRun(event) || !record(event)) {
          if (ledgerFailure === undefined) signal({ kind: "unparsed", line });
          break;
        }
      }
      result.signals.forEach(signal);
    },
  });

  control.handle = handle;

  const finished = handle.done.then(async (exit) => {
    if (ledgerFailure !== undefined) throw ledgerFailure;
    const diffStat = await options.collectDiff?.().catch(() => undefined);
    /*
     * The last event, and the only one recorded after the run is already over. That distinction is the whole
     * reason it is handled separately from `record`: a ledger that closes while a run is *working* must stop it —
     * work nobody can record is a subscription being spent into the void — but a ledger that closes between the
     * agent exiting and this line has nothing left to stop. The daemon is shutting down and the run is finished.
     *
     * This used to be a bare `ledger.append`, which made the single most important event a run produces the only
     * one with no handling at all. It threw out of this promise with nobody holding it. CI found it on macOS as
     * two errors printed beside 695 passing tests — the shape of a bug a green suite hides.
     */
    if (ledger.isOpen) {
      record({
        type: "run.finished",
        ...ids,
        status: exit.status,
        exitCode: exit.exitCode,
        ...(existsSync(context.reportPath) ? { reportPath: context.reportPath } : {}),
        ...(diffStat === undefined ? {} : { diffStat }),
      });
      /*
       * Read through a call rather than the variable: `record` assigns it from inside a closure, and narrowing
       * from the check at the top of this promise would otherwise make the line below dead code to the compiler
       * and live code at runtime — which lint caught, correctly.
       */
      const broke = ledgerBroke();
      if (broke !== undefined) throw broke;
    }
    return exit;
  });

  return { handle, finished };
}
