import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { PlanGraph, type PlanLine } from "@fanout/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createWorkspaceManager, DenyListError } from "../src/workspace/manager.ts";
import type { WorkspaceManager } from "../src/workspace/types.ts";

/*
 * These tests drive real git on a real repository in a temp directory. Isolation is the promise that matters most,
 * so nothing here is mocked: if git behaves differently, we want to know here rather than on someone's machine.
 */

const MISSION = "csv-export";

function plan(role: PlanLine["role"], write: string[]): PlanLine {
  const [line] = PlanGraph.parse({
    lines: [{ id: "api", title: "API", role, prompt: "Build it.", seat: { id: "fake" }, scope: { write } }],
  }).lines;
  if (line === undefined) throw new Error("fixture plan has no line");
  return line;
}

let dir: string;
let repo: string;
let workspaceRoot: string;
let baseCommit: string;
let workspaces: WorkspaceManager;

/*
 * A closed environment on purpose. Inheriting process.env would carry GIT_DIR and GIT_INDEX_FILE whenever the
 * suite runs from a git hook (our pre-push check does), and every git call here would then act on the repository
 * we are pushing instead of the temp one. The daemon's own git runner closes the environment for the same reason.
 */
function run(args: string[], cwd = repo): string {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    env: {
      PATH: process.env["PATH"] ?? "",
      HOME: process.env["HOME"] ?? "",
      GIT_CONFIG_NOSYSTEM: "1",
      LC_ALL: "C",
    },
  });
}

function write(path: string, content: string, root = repo): void {
  const full = join(root, path);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, content, "utf8");
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "fanout-workspace-"));
  repo = join(dir, "repo");
  workspaceRoot = join(dir, "workspaces");
  mkdirSync(repo);
  run(["init", "--quiet", "-b", "main"]);
  run(["config", "user.email", "crew@example.invalid"]);
  run(["config", "user.name", "Fanout tests"]);
  write(".gitignore", "ignored/\n*.log\n");
  write("src/api/csv.ts", "export const csv = 1;\n");
  write("src/ui/table.ts", "export const table = 1;\n");
  write("docs/notes (draft).md", "# notes\n");
  write("ignored/secret.txt", "not for agents\n");
  write("debug.log", "noise\n");
  run(["add", "-A"]);
  run(["commit", "--quiet", "-m", "seed"]);
  baseCommit = run(["rev-parse", "HEAD"]).trim();
  workspaces = createWorkspaceManager({ repoRoot: repo, workspaceRoot });
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("workspace for an editing run", () => {
  it("is a worktree on a throwaway branch, without ignored files, leaving the repository alone", async () => {
    const before = run(["status", "--porcelain"]) + run(["rev-parse", "HEAD"]);
    const workspace = await workspaces.create({
      missionId: MISSION,
      runId: "api-1",
      baseCommit,
      line: plan("builder", ["src/api/**"]),
    });

    expect(workspace).toMatchObject({ kind: "worktree", branch: `fanout/${MISSION}/api-1`, baseCommit });
    expect(readFileSync(join(workspace.path, "src/api/csv.ts"), "utf8")).toBe("export const csv = 1;\n");
    expect(existsSync(join(workspace.path, "ignored/secret.txt"))).toBe(false);
    expect(existsSync(join(workspace.path, "debug.log"))).toBe(false);
    expect(run(["status", "--porcelain"]) + run(["rev-parse", "HEAD"])).toBe(before);
    expect(run(["branch", "--show-current"]).trim()).toBe("main");
  });

  it("reports what the run changed, and what it wrote outside its scope", async () => {
    const line = plan("builder", ["src/api/**"]);
    const workspace = await workspaces.create({ missionId: MISSION, runId: "api-1", baseCommit, line });

    write("src/api/csv.ts", "export const csv = 2;\nexport const extra = 1;\n", workspace.path);
    write("src/api/writer.ts", "export const writer = 1;\n", workspace.path);
    write("src/ui/table.ts", "export const table = 2;\n", workspace.path);
    write("ignored/secret.txt", "still ignored\n", workspace.path);

    const diff = await workspaces.collect(workspace, line);
    expect(diff.stat.files).toBe(3);
    expect(diff.stat.insertions).toBeGreaterThan(0);
    expect(diff.newFiles).toEqual(["src/api/writer.ts"]);
    expect(diff.outsideScope).toEqual(["src/ui/table.ts"]);
    expect(diff.patch).toContain("src/api/csv.ts");
  });

  /*
   * Found by watching `fanout demo`: a run that wrote a whole new file reported "+0 −0", which reads as a run
   * that did nothing. New files were counted towards the file total and their lines were never counted at all.
   */
  it("counts the lines in a new file, not just the file", async () => {
    const line = plan("builder", ["src/api/**"]);
    const workspace = await workspaces.create({ missionId: MISSION, runId: "api-1", baseCommit, line });

    write("src/api/brand-new.ts", "one\ntwo\nthree\n", workspace.path);

    const diff = await workspaces.collect(workspace, line);
    expect(diff.stat.files).toBe(1);
    expect(diff.stat.insertions).toBe(3);
    expect(diff.stat.deletions).toBe(0);
  });

  it("counts a new file with no trailing newline as the line it is", async () => {
    const line = plan("builder", ["src/api/**"]);
    const workspace = await workspaces.create({ missionId: MISSION, runId: "api-1", baseCommit, line });

    write("src/api/one-liner.ts", "no newline at the end", workspace.path);

    expect((await workspaces.collect(workspace, line)).stat.insertions).toBe(1);
  });

  it("adds a new file's lines to the ones the tracked changes already had", async () => {
    const line = plan("builder", ["src/api/**"]);
    const workspace = await workspaces.create({ missionId: MISSION, runId: "api-1", baseCommit, line });

    write("src/api/csv.ts", "export const csv = 2;\nexport const extra = 1;\n", workspace.path);
    write("src/api/writer.ts", "a\nb\n", workspace.path);

    const diff = await workspaces.collect(workspace, line);
    expect(diff.stat.insertions).toBeGreaterThanOrEqual(3);
  });

  it("does not invent a line count for a binary file", async () => {
    const line = plan("builder", ["src/api/**"]);
    const workspace = await workspaces.create({ missionId: MISSION, runId: "api-1", baseCommit, line });

    // Git reports "-" rather than a number for binary; counting its bytes as lines would be a made-up figure.
    writeFileSync(
      join(workspace.path, "src", "api", "logo.png"),
      Buffer.from([0x89, 0x50, 0x00, 0x1a, 0x0a]),
    );

    const diff = await workspaces.collect(workspace, line);
    expect(diff.stat.files).toBe(1);
    expect(diff.stat.insertions).toBe(0);
  });

  it("collects a patch that applies back to the repository", async () => {
    const line = plan("builder", ["src/**"]);
    const workspace = await workspaces.create({ missionId: MISSION, runId: "api-1", baseCommit, line });
    write("src/api/csv.ts", "export const csv = 42;\n", workspace.path);
    write("docs/notes (draft).md", "# notes\n\nwith a space in the name\n", workspace.path);

    const diff = await workspaces.collect(workspace, line);
    const patchFile = join(dir, "run.patch");
    writeFileSync(patchFile, diff.patch, "utf8");
    run(["apply", "-3", patchFile]);

    expect(readFileSync(join(repo, "src/api/csv.ts"), "utf8")).toBe("export const csv = 42;\n");
    expect(readFileSync(join(repo, "docs/notes (draft).md"), "utf8")).toContain("with a space");
    expect(diff.outsideScope).toEqual(["docs/notes (draft).md"]);
  });

  it("reports the truth even when the agent stages or commits, which it must not do", async () => {
    const line = plan("builder", ["src/**"]);
    const workspace = await workspaces.create({ missionId: MISSION, runId: "api-1", baseCommit, line });

    write("src/api/csv.ts", "export const csv = 3;\n", workspace.path);
    run(["add", "src/api/csv.ts"], workspace.path);
    write("src/api/committed.ts", "export const sneaky = 1;\n", workspace.path);
    run(["add", "-A"], workspace.path);
    run(["commit", "--quiet", "-m", "an agent should never do this"], workspace.path);
    write("src/api/afterwards.ts", "export const later = 1;\n", workspace.path);

    const diff = await workspaces.collect(workspace, line);
    expect(diff.patch).toContain("export const csv = 3;");
    expect(diff.patch).toContain("src/api/committed.ts");
    expect(diff.newFiles).toEqual(["src/api/afterwards.ts"]);
    expect(diff.stat.files).toBe(3);
  });

  it("removes the workspace and its branch without touching the repository", async () => {
    const workspace = await workspaces.create({
      missionId: MISSION,
      runId: "api-1",
      baseCommit,
      line: plan("builder", ["src/**"]),
    });
    await workspaces.remove(workspace);

    expect(existsSync(workspace.path)).toBe(false);
    expect(run(["worktree", "list"])).not.toContain(workspace.path);
    expect(run(["branch", "--list", `fanout/${MISSION}/api-1`]).trim()).toBe("");
    expect(run(["status", "--porcelain"]).trim()).toBe("");
  });

  it("removes every workspace of a mission, including one left by a crash", async () => {
    const line = plan("builder", ["src/**"]);
    const first = await workspaces.create({ missionId: MISSION, runId: "api-1", baseCommit, line });
    const second = await workspaces.create({ missionId: MISSION, runId: "ui-1", baseCommit, line });
    rmSync(second.path, { recursive: true, force: true }); // a crash left the directory gone but git still knows

    await workspaces.removeAll(MISSION);

    expect(existsSync(first.path)).toBe(false);
    expect(run(["worktree", "list"]).trim().split("\n")).toHaveLength(1);
    expect(run(["branch", "--list", `fanout/${MISSION}/*`]).trim()).toBe("");
  });
});

describe("workspace for an auditor", () => {
  it("is an export with no git directory and no ignored files", async () => {
    const line = plan("auditor", []);
    const workspace = await workspaces.create({ missionId: MISSION, runId: "audit-1", baseCommit, line });

    expect(workspace).toMatchObject({ kind: "archive", branch: null });
    expect(readFileSync(join(workspace.path, "src/api/csv.ts"), "utf8")).toBe("export const csv = 1;\n");
    expect(existsSync(join(workspace.path, ".git"))).toBe(false);
    expect(existsSync(join(workspace.path, "ignored/secret.txt"))).toBe(false);
    expect(await workspaces.collect(workspace, line)).toMatchObject({
      stat: { files: 0, insertions: 0, deletions: 0 },
      newFiles: [],
      outsideScope: [],
    });
  });
});

describe("the deny-list", () => {
  it.each([
    [".env", "SECRET=invented\n"],
    ["config/service-account.json", "{}\n"],
    ["deploy/server.key", "invented\n"],
    [".ssh/id_ed25519", "invented\n"],
  ])("refuses to build a workspace while the repository tracks %s", async (path, content) => {
    write(path, content);
    run(["add", "-A"]);
    run(["commit", "--quiet", "-m", "add a file agents must not see"]);
    const commit = run(["rev-parse", "HEAD"]).trim();

    const attempt = workspaces.create({
      missionId: MISSION,
      runId: "api-1",
      baseCommit: commit,
      line: plan("builder", ["src/**"]),
    });

    await expect(attempt).rejects.toBeInstanceOf(DenyListError);
    await expect(attempt).rejects.toThrow(path);
    expect(existsSync(join(workspaceRoot, MISSION, "api-1"))).toBe(false);
  });

  it("allows a repository whose secrets are only ignored, never tracked", async () => {
    write("ignored/.env", "SECRET=invented\n");
    const workspace = await workspaces.create({
      missionId: MISSION,
      runId: "api-1",
      baseCommit,
      line: plan("builder", ["src/**"]),
    });
    expect(existsSync(join(workspace.path, "ignored/.env"))).toBe(false);
  });
});
