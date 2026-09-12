import { createHash } from "node:crypto";
import { git, zeroSeparated } from "../workspace/git.ts";

/*
 * The identity of a working tree's uncommitted work.
 *
 * The gate's every claim — reviewed, checked, proven, approved — is about a specific diff, and a working tree is
 * not a specific anything: it changes under you. Hashing what is actually there turns "the current changes" into a
 * name that two steps can be compared against, which is the difference between "this was reviewed" and "something
 * was reviewed once".
 *
 * The hash covers tracked modifications *and* new files, because a change that only adds files has an empty
 * `git diff` and would otherwise share a revision with a clean tree — the most dangerous collision available here.
 */

export interface RevisionOptions {
  cwd: string;
  /** Untracked files to include. Defaults to everything git would show as untracked and not ignored. */
  timeoutMs?: number;
}

export interface WorkSnapshot {
  /** sha-256 over the diff and the new files, or the hash of "nothing" when the tree is clean. */
  revision: string;
  /** Repo-relative paths this work touches, sorted. Empty when the tree is clean. */
  files: string[];
  /** The new files among them: they are copied into an isolated review rather than patched into it. */
  newFiles: string[];
  clean: boolean;
  /** The repository root, resolved from whatever directory we were pointed at. */
  repoRoot: string;
}

/** The sha-256 of an empty snapshot: a clean tree always has this revision, on every machine. */
export const CLEAN_REVISION = createHash("sha256")
  .update("fanout/work/v1\n")
  .update("\0staged\0")
  .digest("hex");

/**
 * What the working tree currently holds, and its name.
 *
 * Deliberately not `git stash create` or `write-tree`: both write objects into the repository, and a tool that
 * inspects your work must not change it. This only reads.
 */
export async function workSnapshot(options: RevisionOptions): Promise<WorkSnapshot> {
  const at =
    (cwd: string) =>
    (args: readonly string[]): Promise<string> =>
      git(args, { cwd, ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }) });

  /*
   * Everything is asked of the repository root, never of whatever directory we happened to be started in.
   * `git ls-files --others` lists only files beneath its working directory and names them relative to it, so
   * running from a package subdirectory would silently miss new files elsewhere and mix two kinds of path.
   */
  const repoRoot = (await at(options.cwd)(["rev-parse", "--show-toplevel"])).trim();
  const run = at(repoRoot);

  // `--no-ext-diff` and `--no-color` so a user's own diff settings cannot change the identity of their work.
  const tracked = await run(["diff", "HEAD", "--no-ext-diff", "--no-color"]);
  /*
   * Staged work is hashed separately. `git diff HEAD` compares the working tree with HEAD, so a change that was
   * staged and then reverted in the working tree is invisible to it while still sitting in the index, ready to be
   * committed — a clean-looking tree that is not clean.
   */
  const staged = await run(["diff", "--cached", "HEAD", "--no-ext-diff", "--no-color"]);
  const untracked = zeroSeparated(await run(["ls-files", "--others", "--exclude-standard", "-z"])).sort();

  const hash = createHash("sha256").update("fanout/work/v1\n");
  hash.update(tracked);
  hash.update("\0staged\0");
  hash.update(staged);
  for (const path of untracked) {
    // The path goes in as well as the bytes: moving a new file is a change, even when its contents are identical.
    hash.update(`\0new\0${path}\0`);
    hash.update(await run(["hash-object", "--", path]));
  }

  const changed = zeroSeparated(await run(["diff", "HEAD", "--name-only", "-z"]));
  const stagedNames = zeroSeparated(await run(["diff", "--cached", "HEAD", "--name-only", "-z"]));
  const files = [...new Set([...changed, ...stagedNames, ...untracked])].sort();

  return {
    revision: hash.digest("hex"),
    files,
    newFiles: [...untracked],
    clean: files.length === 0,
    repoRoot,
  };
}
