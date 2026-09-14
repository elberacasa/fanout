import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { isolateWork } from "../src/gate/isolate.ts";

/*
 * The path we hand a reviewer has to be the path the reviewer will find.
 *
 * Found by using the product: `fanout review` on a real change came back with an accurate, well-argued comment
 * citing `/privatesrc/due.ts:18`. There is no such file. `os.tmpdir()` on macOS is `/var/folders/…`, a symlink
 * to `/private/var/folders/…`; the reviewer resolved the working directory we gave it, subtracted the
 * unresolved spelling we had told it about, and emitted the difference. A citation nobody can open makes a
 * correct review useless, so this is a correctness bug rather than a cosmetic one.
 *
 * The test forces the condition rather than relying on the host: TMPDIR is pointed at a symlink, so this fails
 * on the old code on every platform instead of only on a Mac.
 */

let base: string;
let repo: string;
let originalTmp: string | undefined;

const git = (args: readonly string[], cwd: string): string =>
  execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null" },
  });

beforeEach(() => {
  base = realpathSync(mkdtempSync(join(tmpdir(), "fanout-realpath-")));

  // A repository with one commit, which is all `isolateWork` needs to make a copy of HEAD.
  repo = join(base, "repo");
  mkdirSync(repo);
  git(["init", "--quiet", "-b", "main"], repo);
  git(["config", "user.email", "test@example.invalid"], repo);
  git(["config", "user.name", "Test"], repo);
  writeFileSync(join(repo, "file.txt"), "before\n");
  git(["add", "-A"], repo);
  git(["commit", "--quiet", "-m", "first"], repo);

  /*
   * The condition itself: a temporary directory reached through a symlink, which is what macOS gives every
   * process by default and what no Linux CI would otherwise reproduce.
   */
  const real = join(base, "real-tmp");
  const link = join(base, "link-tmp");
  mkdirSync(real);
  symlinkSync(real, link);
  originalTmp = process.env["TMPDIR"];
  process.env["TMPDIR"] = link;
});

afterEach(() => {
  if (originalTmp === undefined) delete process.env["TMPDIR"];
  else process.env["TMPDIR"] = originalTmp;
  rmSync(base, { recursive: true, force: true });
});

describe("the review copy's path", () => {
  it("is already resolved, so a reviewer's citations point at files that exist", async () => {
    const work = await isolateWork({ repoRoot: repo, newFiles: [] });

    try {
      // The property that matters: what we hand out survives being resolved. On the old code the copy lived at
      // the symlinked spelling and this differed by a `/private` prefix.
      expect(work.path).toBe(realpathSync(work.path));
    } finally {
      await work.dispose();
    }
  });

  it("still produces a usable copy of the work", async () => {
    // Guards the fix itself: resolving the root must not break the worktree it is the root of.
    writeFileSync(join(repo, "file.txt"), "after\n");
    const work = await isolateWork({ repoRoot: repo, newFiles: [] });

    try {
      expect(work.path).toContain("fanout-review-");
      // The uncommitted change has to have travelled, or the reviewer is reading the wrong bytes.
      expect(execFileSync("cat", [join(work.path, "file.txt")], { encoding: "utf8" })).toBe("after\n");
    } finally {
      await work.dispose();
    }
  });
});
