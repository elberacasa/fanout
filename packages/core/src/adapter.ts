import type { FanoutEventInput } from "./schema/events.ts";
import type { PlanLine } from "./schema/plan.ts";

/*
 * The contract between the daemon and one agent CLI. An adapter is data plus two pure functions: how to start a run
 * (`command`) and how to read one line of the CLI's output (`parse`). It never touches credentials: it only calls the
 * vendor's CLI the way its documentation describes non-interactive use. See docs/ADAPTERS.md.
 */

/** Exactly what the supervisor spawns. Nothing else is inherited: `env` is the child's whole environment. */
export interface LaunchSpec {
  argv: [string, ...string[]];
  cwd: string;
  env: Record<string, string>;
}

export interface AdapterContext {
  missionId: string;
  runId: string;
  line: PlanLine;
  /** The run's worktree, or a read-only archive for auditors. */
  workdir: string;
  /** Where the agent's final report goes, when the CLI can write one. */
  reportPath: string;
  /** The environment the daemon allows (PATH, HOME, locale, …). Adapters may add to it, never widen it with secrets. */
  baseEnv: Record<string, string>;
}

/** Hints for the daemon that are not recorded as events directly; the daemon decides what they mean. */
export type AdapterSignal =
  | { kind: "session"; id: string }
  | { kind: "limit"; message: string; resetsAt?: string }
  | { kind: "report"; text: string }
  | { kind: "unparsed"; line: string };

export interface ParseResult {
  events: FanoutEventInput[];
  signals: AdapterSignal[];
}

export interface SeatAdapter {
  readonly id: string;
  command(context: AdapterContext): LaunchSpec;
  /** Maps one line of the CLI's stdout. Never throws: unknown lines become an `unparsed` signal. */
  parse(line: string, context: AdapterContext): ParseResult;
}
