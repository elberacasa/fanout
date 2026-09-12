import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, renameSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CLEAN_REVISION, workSnapshot } from "../src/gate/revision.ts";

/*
 * A revision names a specific diff so that "this was reviewed" cannot quietly become "something was reviewed".
 * Everything here is about what must and must not change that name.
 */

const gitEnv = {
  PATH: process.env["PATH"] ?? "",
  HOME: process.env["HOME"] ?? "",
  GIT_CONFIG_NOSYSTEM: "1",
  LC_ALL: "C",
};

let repo: string;
const run = (args: string[]): string =>
  execFileSync("git", args, { cwd: repo, encoding: "utf8", env: gitEnv });
function write(path: string, text: string): void {
  writeFileSync(join(repo, path), text);
}
const revision = async (): Promise<string> => (await workSnapshot({ cwd: repo })).revision;

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), "fanout-rev-"));
  run(["init", "--quiet", "-b", "main"]);
  run(["config", "user.email", "crew@example.invalid"]);
  run(["config", "user.name", "Fanout tests"]);
  mkdirSync(join(repo, "src"));
  write("src/a.ts", "export const a = 1;\n");
  run(["add", "-A"]);
  run(["commit", "--quiet", "-m", "seed"]);
});
afterEach(() => {
  rmSync(repo, { recursive: true, force: true });
});

describe("naming the work in a tree", () => {
  it("gives a clean tree the same revision everywhere", async () => {
    const snapshot = await workSnapshot({ cwd: repo });
    expect(snapshot).toMatchObject({ revision: CLEAN_REVISION, files: [], clean: true });
  });

  it("changes the revision when a tracked file changes", async () => {
    const before = await revision();
    write("src/a.ts", "export const a = 2;\n");
    expect(await revision()).not.toBe(before);
  });

  it("gives the same revision for the same content, so nothing is re-reviewed for nothing", async () => {
    write("src/a.ts", "export const a = 2;\n");
    const first = await revision();
    write("src/a.ts", "export const a = 3;\n");
    write("src/a.ts", "export const a = 2;\n");
    expect(await revision()).toBe(first);
  });

  /*
   * The collision that would matter most. A change that only adds files has an empty `git diff`, so a revision
   * built from the diff alone would call it identical to a clean tree — and a clean tree passes every check.
   */
  it("does not call a tree with a new file clean", async () => {
    write("src/new.ts", "export const b = 2;\n");
    const snapshot = await workSnapshot({ cwd: repo });

    expect(snapshot.revision).not.toBe(CLEAN_REVISION);
    expect(snapshot.clean).toBe(false);
    expect(snapshot.files).toContain("src/new.ts");
  });

  it("notices a new file's contents changing", async () => {
    write("src/new.ts", "export const b = 2;\n");
    const before = await revision();
    write("src/new.ts", "export const b = 3;\n");
    expect(await revision()).not.toBe(before);
  });

  it("notices a new file being moved, even with identical contents", async () => {
    write("src/new.ts", "export const b = 2;\n");
    const before = await revision();
    renameSync(join(repo, "src/new.ts"), join(repo, "src/moved.ts"));
    expect(await revision()).not.toBe(before);
  });

  it("ignores files git is told to ignore, which is where secrets live", async () => {
    write(".gitignore", ".env\n");
    run(["add", ".gitignore"]);
    run(["commit", "--quiet", "-m", "ignore"]);
    const before = await revision();

    write(".env", "TOKEN=shouldnotmatter\n");
    const snapshot = await workSnapshot({ cwd: repo });
    expect(snapshot.revision).toBe(before);
    expect(snapshot.files).not.toContain(".env");
  });

  it("lists every touched path once, sorted", async () => {
    write("src/a.ts", "export const a = 2;\n");
    write("src/b.ts", "export const b = 1;\n");
    const snapshot = await workSnapshot({ cwd: repo });
    expect(snapshot.files).toEqual(["src/a.ts", "src/b.ts"]);
  });

  it("does not write anything into the repository while looking", async () => {
    write("src/a.ts", "export const a = 2;\n");
    const before = run(["status", "--porcelain"]);
    await workSnapshot({ cwd: repo });

    // A tool that inspects your work must not change it: no stash, no write-tree, no index churn.
    expect(run(["status", "--porcelain"])).toBe(before);
  });
});

/*
 * Both found by Codex reviewing this file (2026-09-12). Each makes a tree that is not clean look clean, and a
 * clean tree skips review entirely — the worst direction for this mistake to run in.
 */
describe("work that could hide from the snapshot", () => {
  it("sees a change that is staged and then reverted in the working tree", async () => {
    write("src/a.ts", "export const a = 2;\n");
    run(["add", "src/a.ts"]);
    write("src/a.ts", "export const a = 1;\n"); // back to HEAD's contents; `git diff HEAD` is now empty

    const snapshot = await workSnapshot({ cwd: repo });
    expect(snapshot.clean).toBe(false);
    expect(snapshot.revision).not.toBe(CLEAN_REVISION);
    expect(snapshot.files).toContain("src/a.ts");
  });

  it("finds work anywhere in the repository when run from a subdirectory", async () => {
    write("src/new.ts", "export const b = 1;\n");
    const fromRoot = await workSnapshot({ cwd: repo });
    const fromSubdirectory = await workSnapshot({ cwd: join(repo, "src") });

    // `git ls-files --others` only lists below its own directory, so this used to miss files elsewhere entirely.
    expect(fromSubdirectory.revision).toBe(fromRoot.revision);
    expect(fromSubdirectory.files).toEqual(["src/new.ts"]);
    expect(fromSubdirectory.repoRoot).toBe(fromRoot.repoRoot);
  });

  it("names new files separately, since they are copied into a review rather than patched", async () => {
    write("src/a.ts", "export const a = 2;\n");
    write("src/new.ts", "export const b = 1;\n");
    const snapshot = await workSnapshot({ cwd: repo });

    expect(snapshot.newFiles).toEqual(["src/new.ts"]);
    expect(snapshot.files).toEqual(["src/a.ts", "src/new.ts"]);
  });
});
