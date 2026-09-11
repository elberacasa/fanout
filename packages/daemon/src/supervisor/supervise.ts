import type { RunHandle, SuperviseOptions } from "./types.ts";

export function supervise(options: SuperviseOptions): RunHandle {
  throw new Error(`supervise(${options.runId}) is not implemented yet`);
}
