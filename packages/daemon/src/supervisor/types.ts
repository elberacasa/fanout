import type { LaunchSpec } from "fanout-core";

export type OutputStream = "stdout" | "stderr";

export interface SuperviseOptions {
  runId: string;
  spec: LaunchSpec;
  /** Both streams are appended here (mode 600); stderr lines are prefixed with "[stderr] ". */
  logPath: string;
  /** The run must print its first stdout byte within this time, or it is stopped as not started. */
  startTimeoutMs: number;
  /** Wall-clock limit for the whole run. */
  timeoutMs: number;
  /** Time between SIGTERM and SIGKILL when stopping a run. */
  killGraceMs: number;
  /** The log stops growing after this many bytes; lines keep flowing to `onLine`. */
  maxLogBytes: number;
  /** Longer lines are cut and marked " …[truncated]". */
  maxLineBytes: number;
  onLine: (line: string, stream: OutputStream) => void;
  onStarted: () => void;
}

export type RunExitStatus = "done" | "failed" | "killed" | "timeout";

export interface RunExit {
  status: RunExitStatus;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  startDetected: boolean;
  durationMs: number;
  /** Why the run failed without a normal exit: a spawn error, or no output before the start timeout. */
  error?: string;
}

export interface RunHandle {
  readonly runId: string;
  /** Undefined when the process could not be spawned. */
  readonly pid: number | undefined;
  /** Resolves once the process is gone. Never rejects. */
  readonly done: Promise<RunExit>;
  /** Stops the whole process group: SIGTERM, then SIGKILL after the grace period. Safe to call twice. */
  kill(reason: string): Promise<RunExit>;
}
