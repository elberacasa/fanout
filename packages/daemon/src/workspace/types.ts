import type { DiffStat, PlanLine } from "@fanout/core";

/*
 * Where an agent works. An editing run gets its own git worktree on a fresh branch from the mission's base commit;
 * an auditor gets a read-only copy with no `.git` at all, so it cannot commit, switch branch or reach history.
 * Neither ever contains ignored files, and both are made by the daemon — an agent never creates its own workspace.
 */

export type WorkspaceKind = "worktree" | "archive";

export interface WorkspaceRequest {
  /** The user's repository. Never written to by a run. */
  repoRoot: string;
  /** The commit every run of this mission starts from. */
  baseCommit: string;
  missionId: string;
  runId: string;
  line: PlanLine;
  /** Where workspaces live, outside the repository (usually ~/.fanout/workspaces). */
  workspaceRoot: string;
}

export interface Workspace {
  runId: string;
  kind: WorkspaceKind;
  /** The agent's working directory. */
  path: string;
  /** The throwaway branch a worktree sits on; archives have none. */
  branch: string | null;
  baseCommit: string;
}

/** What an editing run produced, read from its workspace without trusting the agent's own account of it. */
export interface RunDiff {
  stat: DiffStat;
  /** A patch against the base commit, ready for `git apply -3`. */
  patch: string;
  /** Files the run added that no patch carries, with their paths relative to the repository. */
  newFiles: string[];
  /** Paths the run wrote that its line never declared. Review sees these first. */
  outsideScope: string[];
}

export interface WorkspaceManager {
  /** Creates the workspace for one run. Refuses rather than exposing anything the deny-list covers. */
  create(request: WorkspaceRequest): Promise<Workspace>;
  /** Reads what the run changed. Safe to call while it is still running. */
  collect(workspace: Workspace, line: PlanLine): Promise<RunDiff>;
  /** Removes the workspace and its branch. Never touches the user's branch or working tree. */
  remove(workspace: Workspace): Promise<void>;
  /** Removes every workspace of a mission, including ones left by a crash. */
  removeAll(missionId: string): Promise<void>;
}
