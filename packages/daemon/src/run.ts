import { existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import {
  InvalidEventError,
  type AdapterContext,
  type AdapterSignal,
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
  const spec = adapter.command(context);

  // The run's own directories are the daemon's to make: the supervisor opens the log before it spawns anything,
  // and an agent should never have to create the place its report goes. Private to the user, like the ledger.
  mkdirSync(dirname(options.logPath), { recursive: true, mode: 0o700 });
  mkdirSync(dirname(context.reportPath), { recursive: true, mode: 0o700 });
  // Callbacks may fire before `supervise` returns, so they reach the handle through this holder.
  const control: { handle?: RunHandle } = {};
  let ledgerFailure: Error | undefined;

  const signal = (value: AdapterSignal): void => {
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

  const finished = handle.done.then((exit) => {
    if (ledgerFailure !== undefined) throw ledgerFailure;
    ledger.append({
      type: "run.finished",
      ...ids,
      status: exit.status,
      exitCode: exit.exitCode,
      ...(existsSync(context.reportPath) ? { reportPath: context.reportPath } : {}),
    });
    return exit;
  });

  return { handle, finished };
}
