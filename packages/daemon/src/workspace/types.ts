import type { DiffStat, PlanLine } from "fanout-core";

/*
 * Where an agent works. An editing run gets its own git worktree on a throwaway branch from the mission's base
 * commit; an auditor gets a copy with no `.git` at all, so it cannot commit, switch branch or read history.
 * Neither ever contains ignored or deny-listed files, and the daemon makes both: an agent never creates its own.
 */

export type WorkspaceKind = "worktree" | "archive";

export interface WorkspaceManagerOptions {
  /** The user's repository. A run never writes here; the merge gate does, after review. */
  repoRoot: string;
  /** Where workspaces live, outside the repository (usually ~/.fanout/workspaces). */
  workspaceRoot: string;
  /** Patterns that must never reach an agent, on top of everything git ignores. */
  denyList?: readonly string[];
}

export interface WorkspaceRequest {
  missionId: string;
  runId: string;
  /** The commit every run of this mission starts from. */
  baseCommit: string;
  line: PlanLine;
}

export interface Workspace {
  missionId: string;
  runId: string;
  kind: WorkspaceKind;
  /** The agent's working directory. */
  path: string;
  /** The throwaway branch a worktree sits on; archives have none. */
  branch: string | null;
  baseCommit: string;
}

/** What a run produced, read from its workspace rather than taken from the agent's own account of it. */
export interface RunDiff {
  stat: DiffStat;
  /** A patch of tracked changes against the base commit, ready for `git apply -3`. */
  patch: string;
  /** Files the run added, which no patch carries, relative to the repository root. */
  newFiles: string[];
  /** Paths the run wrote that its line never declared. Review sees these first. */
  outsideScope: string[];
}

export interface WorkspaceManager {
  /** Creates the workspace for one run, or refuses rather than exposing anything deny-listed. */
  create(request: WorkspaceRequest): Promise<Workspace>;
  /** Reads what the run changed. Safe to call while it is still running. */
  collect(workspace: Workspace, line: PlanLine): Promise<RunDiff>;
  /** Removes one workspace and its branch. Never touches the user's branch or working tree. */
  remove(workspace: Workspace): Promise<void>;
  /** Removes every workspace of a mission, including ones a crash left behind. */
  removeAll(missionId: string): Promise<void>;
}
