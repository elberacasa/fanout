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
  /**
   * The conversation to continue, when this run is a rework of an earlier one.
   *
   * Present only for a resumed run, and only for a seat whose CLI can resume at all. `command` ignores it; it is
   * `resume`'s whole input.
   */
  sessionId?: string;
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
  /**
   * How full a seat's quota window is, when the CLI says so itself: 0.28 means 28% of that window is used.
   * Real, not estimated. Claude Code reports one per turn; most CLIs report nothing and the crew estimates instead.
   */
  | { kind: "quota"; window: string; utilization: number; resetsAt?: string }
  | { kind: "report"; text: string }
  /** The CLI reported a problem of its own. Kept whole: a swallowed error is how a run fails silently. */
  | { kind: "error"; message: string }
  | { kind: "unparsed"; line: string };

export interface ParseResult {
  events: FanoutEventInput[];
  signals: AdapterSignal[];
}

export interface SeatAdapter {
  readonly id: string;
  command(context: AdapterContext): LaunchSpec;
  /**
   * Continues the conversation that produced an earlier diff, with the reviewer's notes as the new instruction.
   *
   * This is why rework is worth more than a second attempt: the agent still holds its own reasoning about the
   * code, so "escape the quotes in the header row too" lands on someone who knows which header row. A fresh run
   * given a summary of that reasoning is a stranger reading a description of a conversation it was not in.
   *
   * Left out by adapters whose CLI cannot resume. The gate asks before it offers rework, and offers a fresh
   * attempt instead rather than pretending — a resumed session that silently started over would be the worst of
   * both, spending a subscription to lose the context it was spent on.
   */
  resume?(context: AdapterContext & { sessionId: string }): LaunchSpec;
  /** Maps one line of the CLI's stdout. Never throws: unknown lines become an `unparsed` signal. */
  parse(line: string, context: AdapterContext): ParseResult;
  /**
   * Maps one line of the CLI's stderr, when that is where it says something we must not miss. Kimi reports a
   * monthly usage limit there and exits non-zero, with nothing in its stream; a daemon reading only stdout would
   * call that a plain failure. Adapters whose stderr carries only noise leave this out.
   */
  parseStderr?(line: string, context: AdapterContext): ParseResult;
}
