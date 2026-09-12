export type * from "./supervisor/types.ts";
export { supervise } from "./supervisor/supervise.ts";
export { ALLOWED_ENV, baseEnv } from "./env.ts";
export { startRun, type ActiveRun, type RunLimits, type StartRunOptions } from "./run.ts";

export type * from "./workspace/types.ts";
export { createWorkspaceManager } from "./workspace/manager.ts";
export { DEFAULT_DENY_LIST, DenyListError, deniedFiles } from "./workspace/deny.ts";
export { git, GitError, lines, zeroSeparated, type GitOptions } from "./workspace/git.ts";

export type * from "./safety/types.ts";
export { safetyReport, type RepositoryState, type SafetyDependencies } from "./safety/report.ts";
export { createSafetyDependencies, type SafetyDependencyOptions } from "./safety/dependencies.ts";

export { detectSeats, type CommandResult, type DetectOptions } from "./detector/detect.ts";
export { compareVersions, parseVersion, satisfies, type Version } from "./detector/version.ts";

export {
  createMissionRunner,
  PlanRefused,
  type LaunchRequest,
  type MissionHandle,
  type MissionOutcome,
  type MissionRunnerOptions,
  type RunOutcome,
} from "./mission/runner.ts";

export { startApi, LEAD_EVENTS, type ApiOptions, type ApiServer } from "./api/server.ts";
export { originAllowed, readOrCreateToken, tokenMatches } from "./api/token.ts";
export * from "./policy/seats.ts";
export * from "./gate/revision.ts";
export * from "./gate/buddy.ts";
export * from "./gate/claims.ts";
export * from "./gate/run-seat.ts";
export { missionViewHtml } from "./api/view.ts";
