import {
  copyFileSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative } from "node:path";
import { pathInScope } from "fanout-core";
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

/**
 * Removes every symbolic link in the copy that points outside it.
 *
 * Found by a cold reader refuting the claim that this could not happen: the earlier guard only covered untracked
 * files copied in, while `git worktree add` faithfully checks out symlinks that HEAD already tracks — and a
 * tracked link may point at an ignored `.env`, at `~/.ssh/id_rsa`, or anywhere else on the machine. The copy is
 * supposed to be the only thing a reviewer can read; a link out of it is a hole in exactly that.
 *
 * Links that stay inside the copy are left alone: they are part of the repository's own shape, and a reviewer
 * following one reads only what it was already shown.
 *
 * Containment is decided by asking the filesystem, never by reading the path. A cold reader refuted the lexical
 * version of this check with a two-link chain — `a -> .` beside `leak -> a/../secret` — where `path.resolve`
 * folds `a/..` away textually and calls the target contained, while the kernel follows `a` to the root first and
 * lands `..` in the parent. Only `realpath`, which walks every link, knows where a path actually goes.
 */
function cutEscapingLinks(root: string): Refused[] {
  /*
   * Walked from the resolved root, not the given one. On macOS a temporary directory is handed out as `/var/...`
   * and resolves to `/private/var/...`; comparing one against the other makes every link inside the copy look
   * like an escape, and this cut all of them until a test said so.
   */
  const inside = realpathSync.native(root);
  const cut: Refused[] = [];

  const walk = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const full = join(directory, entry.name);
      // `.git` in a linked worktree is a file pointing at the real repository, which is not ours to rewrite.
      if (entry.name === ".git") continue;

      if (entry.isSymbolicLink()) {
        if (!staysInside(inside, full)) {
          rmSync(full, { force: true });
          cut.push({ path: relative(inside, full), reason: "symlink" });
        }
        continue;
      }
      if (entry.isDirectory()) walk(full);
    }
  };

  walk(inside);
  return cut;
}

/**
 * Does following this link, all the way, land inside `root`?
 *
 * `realpath` resolves every link in the chain, which is the only answer that matches what a reader actually gets.
 * A link we cannot resolve at all — dangling, or a loop — is cut: it shows a reviewer nothing, and a path the
 * filesystem will not explain is not one we can promise anything about.
 */
export function staysInside(root: string, link: string): boolean {
  let real: string;
  let inside: string;
  try {
    // Both sides resolved the same way, or a macOS `/var` against a `/private/var` makes everything look outside.
    inside = realpathSync.native(root);
    /*
     * `.native` is not an optimisation here, it is the correctness. Node's JavaScript `realpathSync` folds `..`
     * segments lexically as it goes, so a chain like `a -> .` beside `leak -> a/a/../../etc/passwd` resolves to a
     * path *inside* the copy while opening it reaches the real `/etc/passwd`. Measured on this machine: the JS
     * version answered `<copy>/etc/passwd`, the native one `/private/etc/passwd`, and reading the link returned
     * the system file. Only the operating system's own resolver is a security boundary.
     */
    real = realpathSync.native(link);
  } catch {
    return false;
  }
  // An empty result means the link resolves to the copy's own root, which is inside it. The chain that made that
  // dangerous is dead anyway: every link is now followed to where it really goes before this is asked.
  const stepsOut = relative(inside, real);
  return !stepsOut.startsWith("..") && !isAbsolute(stepsOut);
}

/** Builds a throwaway worktree holding HEAD plus whatever is currently uncommitted. */
export async function isolateWork(options: IsolateOptions): Promise<IsolatedWork> {
  const run = (args: readonly string[], cwd: string = options.repoRoot): Promise<string> =>
    git(args, { cwd, ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }) });

  /*
   * Resolved, not as the platform spells it.
   *
   * `os.tmpdir()` is a symlink on macOS — `/var/folders/…` pointing at `/private/var/folders/…` — so the review
   * copy's path has two spellings, and we hand the reviewer the one that is a lie. Found by reading a real
   * review: Codex cited the file as `/privatesrc/due.ts:18`, having resolved the cwd we gave it to its real
   * path and then subtracted the unresolved one we told it about. The comment was right and the citation was
   * unusable, which is the worst shape for a review to take — a reader who cannot find the line stops believing
   * the finding.
   *
   * Everything downstream inherits this: the worktree git registers, the cwd the seat runs in, the paths in its
   * output. One `realpath` here is the whole fix.
   */
  const root = realpathSync.native(mkdtempSync(join(tmpdir(), "fanout-review-")));
  const patches = realpathSync.native(mkdtempSync(join(tmpdir(), "fanout-patch-")));
  const path = join(root, "work");
  let created = false;

  /*
   * Patches are written beside the copy and applied by file, so that every git call in this module goes through
   * the one helper that closes the environment. There used to be a second, bespoke invocation here that piped the
   * patch to stdin and inherited the shell's — which in an editor's integrated terminal means its GIT_ASKPASS,
   * its IPC auth token, and the user's system git config. Deleting the second path is a better guarantee than
   * testing it, because there is now nothing left to drift.
   */
  const applyPatch = async (patch: string, name: string): Promise<void> => {
    // Written outside the copy's own parent and removed immediately: `..` from the copy should hold nothing
    // worth reaching, so that a link we failed to catch has less to find.
    const file = join(patches, name);
    writeFileSync(file, patch, "utf8");
    try {
      await run(["apply", "--whitespace=nowarn", file], path);
    } finally {
      rmSync(file, { force: true });
    }
  };

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
    rmSync(patches, { recursive: true, force: true });
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
    if (patch.trim() !== "") await applyPatch(patch, "worktree.patch");

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
      if (staged.trim() !== "") await applyPatch(staged, "staged.patch");
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

    // Last, because a link can arrive three ways — checked out from HEAD, added by a patch, or copied in — and
    // only a sweep of what is actually on disk catches all three.
    refused.push(...cutEscapingLinks(path));

    return { path, refused, dispose };
  } catch (cause) {
    await dispose();
    throw cause;
  }
}
