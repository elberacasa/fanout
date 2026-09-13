import type { LaunchSpec, PlanGraph, SafetyCheck, SeatInfo } from "fanout-core";

/*
 * The gate between a plan and running it. The report is computed from the plan, the repository and the seats that
 * would run it — never from an agent's word — and it must be green before a launch, or explicitly overridden by the
 * user. Every check names the lines it concerns, so the answer to "why can't I launch?" is always specific.
 */

export interface SafetyInput {
  plan: PlanGraph;
  /** Which revision of the plan this report describes; a newer plan invalidates it. */
  planRevision: number;
  repo: { root: string; baseCommit: string };
  /** The seats as detected: version, sign-in state, the modes they support. */
  seats: Record<string, SeatInfo>;
  /** The exact command each line would run, from its adapter. Shown to the user as the dry run. */
  commands: Record<string, LaunchSpec>;
  /** Patterns that must never reach an agent, on top of what git already ignores. */
  denyList: readonly string[];
  /** How many runs may work at once, overall and per seat. */
  limits: { maxParallel: number; perSeat: Record<string, number> };
}

export interface SafetyReport {
  /** True only when no blocking check failed. Warnings are shown but do not stop a launch. */
  ok: boolean;
  planRevision: number;
  checks: SafetyCheck[];
  /** The commands that would run, in launch order, for the user to read before approving. */
  dryRun: { lineId: string; seat: string; argv: string[]; cwd: string }[];
}

/**
 * The checks, in the order a person would ask them:
 *  - `scopes-disjoint`   no two lines that can run at once may write the same path (blocking)
 *  - `scopes-declared`   every builder and tester declares where it writes (blocking)
 *  - `secrets-excluded`  no deny-listed or ignored file can appear in any workspace (blocking)
 *  - `seat-available`    each line's seat is installed, signed in and a supported version (blocking)
 *  - `permission-mode`   each seat runs in the safest mode it offers that can still do the work (blocking)
 *  - `network`           network is off where the CLI can turn it off (warning when it cannot)
 *  - `concurrency`       the plan respects the mission and per-seat limits (blocking)
 *  - `base-commit`       the repository is at the mission's base commit, with nothing uncommitted in scope (blocking)
 */
export type SafetyCheckId =
  | "scopes-disjoint"
  | "scopes-declared"
  | "secrets-excluded"
  | "seat-available"
  | "permission-mode"
  | "network"
  | "concurrency"
  | "base-commit";
