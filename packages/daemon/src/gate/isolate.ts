import { copyFileSync, lstatSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { pathInScope } from "@fanout/core";
import { DEFAULT_DENY_LIST } from "../workspace/deny.ts";
import { git, zeroSeparated } from "../workspace/git.ts";

/*
 * A copy of the lead's uncommitted work, with nothing else in it.
 *
 * Isolation is the third non-negotiable and it is not satisfied by a read-only sandbox: read-only stops a reviewer
 * writing, not reading, so a reviewer launched in the repository can open `.env`, a private key, or any other
 * ignored file that happens to be lying there. Filtering which paths we *tell* it about changes nothing, because
 * its tools can look anywhere.
 *
 * So the reviewer never sees the repository. It sees a fresh worktree at HEAD with exactly the changes applied —
 * ignored files do not exist in a worktree, which makes that half of the guarantee structural rather than a
 * promise about behaviour.
 *
 * Three ways secrets got in anyway, all found by a second vendor reviewing this file, all now closed: a `.env`
 * that HEAD *tracks* lands in the worktree and has to be deleted from the copy (the deny-list, the same one the
 * mission workspaces use); an untracked symlink with an innocent name dereferences to whatever it points at, so
 * links are refused rather than followed; and work that is staged but reverted in the working tree is invisible
 * to `git diff HEAD`, so the reviewer would have read a copy missing the very change being reviewed.
 */

export interface IsolatedWork {
  /** Where the reviewer should run. Contains the repository at HEAD plus the uncommitted changes. */
  path: string;
  /** Files deliberately kept out of the copy. The caller tells the user, so nobody wonders why a file is missing. */
  refused: Refused[];
  /** Removes the copy. Safe to call twice. */
  dispose: () => Promise<void>;
}

export interface IsolateOptions {
  repoRoot: string;
  /** Repo-relative paths that are new files, from the snapshot; they are copied in, not patched. */
  newFiles: readonly string[];
  timeoutMs?: number;
  denyList?: readonly string[];
}

/** A file the copy refused to include, and why — reported, never silently dropped. */
export interface Refused {
  path: string;
  reason: "deny-list" | "symlink";
}

/** Builds a throwaway worktree holding HEAD plus whatever is currently uncommitted. */
export async function isolateWork(options: IsolateOptions): Promise<IsolatedWork> {
  const run = (args: readonly string[], cwd: string = options.repoRoot): Promise<string> =>
    git(args, { cwd, ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }) });

  const root = mkdtempSync(join(tmpdir(), "fanout-review-"));
  const path = join(root, "work");
  let created = false;

  const dispose = async (): Promise<void> => {
    if (created) {
      // `git worktree remove` first so the repository's administrative files are updated, not orphaned.
      try {
        await run(["worktree", "remove", "--force", path]);
      } catch {
        // A worktree we cannot unregister still must not be left on disk.
      }
    }
    rmSync(root, { recursive: true, force: true });
  };

  try {
    await run(["worktree", "add", "--detach", "--quiet", path, "HEAD"]);
    created = true;

    const denyList = options.denyList ?? DEFAULT_DENY_LIST;
    const refused: Refused[] = [];

    /*
     * A secret that HEAD tracks is already in this worktree, because a worktree is a checkout of HEAD. Ignored
     * files never arrive, but a committed `.env` does, so it is removed from the copy before anything runs.
     */
    for (const file of zeroSeparated(await run(["ls-tree", "-r", "-z", "--name-only", "HEAD"], path))) {
      if (denyList.some((pattern) => pathInScope(file, pattern))) {
        rmSync(join(path, file), { force: true });
        refused.push({ path: file, reason: "deny-list" });
      }
    }

    // The working tree as it stands.
    const patch = await run(["diff", "HEAD", "--no-ext-diff", "--no-color", "--binary"]);
    if (patch.trim() !== "") await applyPatch(patch, path, options.timeoutMs);

    /*
     * Then any file whose *index* differs from HEAD but whose working tree does not: staged, then reverted. It is
     * invisible to the patch above, and a reviewer given a copy without it would be reviewing different work from
     * the one whose revision we record.
     */
    const inWorktree = new Set(zeroSeparated(await run(["diff", "HEAD", "--name-only", "-z"])));
    const stagedOnly = zeroSeparated(await run(["diff", "--cached", "HEAD", "--name-only", "-z"])).filter(
      (file) => !inWorktree.has(file),
    );
    if (stagedOnly.length > 0) {
      const staged = await run([
        "diff",
        "--cached",
        "HEAD",
        "--no-ext-diff",
        "--no-color",
        "--binary",
        "--",
        ...stagedOnly,
      ]);
      if (staged.trim() !== "") await applyPatch(staged, path, options.timeoutMs);
    }

    /*
     * New files are copied rather than patched. They come from the snapshot, which asks git for untracked files
     * excluding standard ignores — but "not ignored" is not the same as "safe to show", so each one is checked
     * again here.
     */
    for (const file of options.newFiles) {
      if (denyList.some((pattern) => pathInScope(file, pattern))) {
        refused.push({ path: file, reason: "deny-list" });
        continue;
      }
      const source = join(options.repoRoot, file);
      /*
       * `copyFileSync` follows symlinks, so an untracked link innocently named `notes.txt` and pointing at an
       * ignored `.env` — or anywhere outside the repository at all — would materialise that file's contents in
       * the copy. Links are refused rather than resolved: a reviewer has no need of one.
       */
      if (lstatSync(source).isSymbolicLink()) {
        refused.push({ path: file, reason: "symlink" });
        continue;
      }
      const destination = join(path, file);
      mkdirSync(dirname(destination), { recursive: true });
      copyFileSync(source, destination);
    }

    return { path, refused, dispose };
  } catch (cause) {
    await dispose();
    throw cause;
  }
}

async function applyPatch(patch: string, cwd: string, timeoutMs?: number): Promise<void> {
  const { execFile } = await import("node:child_process");
  const failure = await new Promise<Error | null>((resolve) => {
    const child = execFile(
      "git",
      ["apply", "--whitespace=nowarn", "-"],
      { cwd, timeout: timeoutMs ?? 60_000 },
      (error) => {
        resolve(error);
      },
    );
    child.stdin?.end(patch);
  });
  if (failure !== null) throw failure;
}
