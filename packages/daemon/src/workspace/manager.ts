import { execFile } from "node:child_process";
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { pathInScope, type DiffStat, type PlanLine } from "@fanout/core";
import { git, lines, zeroSeparated, GitError } from "./git.ts";
import type {
  RunDiff,
  Workspace,
  WorkspaceManager,
  WorkspaceManagerOptions,
  WorkspaceRequest,
} from "./types.ts";

/*
 * Isolation, done by the daemon so that no agent has to be trusted with it.
 *
 * An editing run gets `git worktree add` on a throwaway branch from the mission's base commit: its own working
 * directory, its own branch, nothing of the user's. An auditor gets an export of the same commit with no `.git`,
 * so it cannot commit, switch branch, read history or reach another run. Ignored files are in neither, because
 * neither is a copy of the user's working tree.
 *
 * What git ignores is not enough on its own: a repository can track a `.env` or a private key. Those are checked
 * for before anything is created, and a workspace is refused rather than quietly exposing them.
 */

const runProcess = promisify(execFile);

/** Files an agent must never receive, even when the repository tracks them. */
export const DEFAULT_DENY_LIST: readonly string[] = [
  "**/.env",
  "**/.env.*",
  "**/*.pem",
  "**/*.key",
  "**/*.p12",
  "**/*.pfx",
  "**/*.keystore",
  "**/id_rsa*",
  "**/id_ed25519*",
  "**/.npmrc",
  "**/.netrc",
  "**/.pgpass",
  "**/.ssh/**",
  "**/.aws/**",
  "**/.gnupg/**",
  "**/secrets.*",
  "**/credentials",
  "**/credentials.*",
  "**/service-account*.json",
];

/** A workspace was not created because the repository holds something an agent must not see. */
export class DenyListError extends Error {
  override name = "DenyListError";
  readonly files: readonly string[];

  constructor(files: readonly string[]) {
    super(
      `The repository tracks ${files.length} file(s) an agent must never receive: ${files.slice(0, 5).join(", ")}` +
        `${files.length > 5 ? ", …" : ""}. Remove them from the commit, or narrow the deny-list on purpose.`,
    );
    this.files = files;
  }
}

export function createWorkspaceManager(options: WorkspaceManagerOptions): WorkspaceManager {
  const { repoRoot, workspaceRoot } = options;
  const denyList = options.denyList ?? DEFAULT_DENY_LIST;
  const inRepo = { cwd: repoRoot };

  const missionDir = (missionId: string): string => join(workspaceRoot, missionId);
  const runDir = (missionId: string, runId: string): string => join(missionDir(missionId), runId);

  /** Tracked files at a commit that the deny-list covers. Checked before any workspace exists. */
  const deniedFiles = async (baseCommit: string): Promise<string[]> => {
    const tracked = zeroSeparated(await git(["ls-tree", "-r", "-z", "--name-only", baseCommit], inRepo));
    return tracked.filter((file) => denyList.some((pattern) => pathInScope(file, pattern)));
  };

  const create = async (request: WorkspaceRequest): Promise<Workspace> => {
    const { missionId, runId, baseCommit, line } = request;
    const denied = await deniedFiles(baseCommit);
    if (denied.length > 0) throw new DenyListError(denied);

    const path = runDir(missionId, runId);
    await rm(path, { recursive: true, force: true });
    await mkdir(missionDir(missionId), { recursive: true, mode: 0o700 });

    if (line.role === "auditor") {
      // An export, not a clone: no .git, so nothing to commit into and no history to read.
      await mkdir(path, { recursive: true, mode: 0o700 });
      await git(
        ["archive", "--format=tar", `--output=${join(missionDir(missionId), `${runId}.tar`)}`, baseCommit],
        inRepo,
      );
      await extractTar(join(missionDir(missionId), `${runId}.tar`), path);
      await rm(join(missionDir(missionId), `${runId}.tar`), { force: true });
      return { missionId, runId, kind: "archive", path, branch: null, baseCommit };
    }

    const branch = `fanout/${missionId}/${runId}`;
    await git(["worktree", "add", "--quiet", "-b", branch, path, baseCommit], inRepo);
    return { missionId, runId, kind: "worktree", path, branch, baseCommit };
  };

  const collect = async (workspace: Workspace, line: PlanLine): Promise<RunDiff> => {
    if (workspace.kind === "archive") {
      return { stat: { files: 0, insertions: 0, deletions: 0 }, patch: "", newFiles: [], outsideScope: [] };
    }
    const inWorkspace = { cwd: workspace.path };
    // Against the base commit, not the index: this stays true even if the agent staged or committed, which it
    // must not do but might. `-z` is the only safe listing for paths with spaces or newlines in them.
    const base = workspace.baseCommit;
    const numstat = lines(
      (await git(["diff", "--numstat", "-z", base, "--"], inWorkspace)).replaceAll("\0", "\n"),
    );
    const newFiles = zeroSeparated(
      await git(["ls-files", "--others", "--exclude-standard", "-z"], inWorkspace),
    ).sort();
    const patch = await git(["diff", "--binary", base, "--"], inWorkspace);

    const changed = numstat.map((entry) => entry.split("\t")[2] ?? "");
    const stat = numstat.reduce<DiffStat>(
      (total, entry) => {
        const [added, removed] = entry.split("\t");
        return {
          files: total.files + 1,
          insertions: total.insertions + count(added),
          deletions: total.deletions + count(removed),
        };
      },
      { files: 0, insertions: 0, deletions: 0 },
    );

    const touched = [...changed, ...newFiles].filter((file) => file !== "");
    const outsideScope = touched
      .filter((file) => !line.scope.write.some((pattern) => pathInScope(file, pattern)))
      .sort();

    return {
      stat: { ...stat, files: stat.files + newFiles.length },
      patch,
      newFiles,
      outsideScope,
    };
  };

  const remove = async (workspace: Workspace): Promise<void> => {
    if (workspace.kind === "worktree") {
      await ignoreMissing(git(["worktree", "remove", "--force", workspace.path], inRepo));
      if (workspace.branch !== null) await ignoreMissing(git(["branch", "-D", workspace.branch], inRepo));
    }
    await rm(workspace.path, { recursive: true, force: true });
  };

  const removeAll = async (missionId: string): Promise<void> => {
    const prefix = `fanout/${missionId}/`;
    const branches = lines(
      await git(["for-each-ref", "--format=%(refname:short)", `refs/heads/${prefix}`], inRepo),
    );
    await rm(missionDir(missionId), { recursive: true, force: true });
    await ignoreMissing(git(["worktree", "prune"], inRepo));
    for (const branch of branches) await ignoreMissing(git(["branch", "-D", branch], inRepo));
  };

  return { create, collect, remove, removeAll };
}

function count(value: string | undefined): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0; // git writes "-" for a binary file
}

async function extractTar(archive: string, into: string): Promise<void> {
  await runProcess("tar", ["-x", "-f", archive, "-C", into], { windowsHide: true });
}

async function ignoreMissing(work: Promise<unknown>): Promise<void> {
  try {
    await work;
  } catch (error) {
    if (!(error instanceof GitError)) throw error;
  }
}
