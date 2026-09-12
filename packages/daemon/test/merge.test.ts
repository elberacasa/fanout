import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PlanGraph, type RunView } from "@fanout/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { filesInPatch, mergeRun } from "../src/gate/merge.ts";

/*
 * The most dangerous function in the product: everything else can be wrong and leave your code alone. So most of
 * these tests are about what it refuses, and every refusal must leave the repository exactly as it was found.
 */

const env = { PATH: process.env["PATH"] ?? "", HOME: process.env["HOME"] ?? "", LC_ALL: "C" };
const REV = "a1".repeat(32);

let repo: string;
let work: string;

const git = (args: string[], cwd = repo): string => execFileSync("git", args, { cwd, env, encoding: "utf8" });

const [line] = PlanGraph.parse({
  lines: [
    {
      id: "api",
      title: "CSV export",
      role: "builder",
      prompt: "Add it.",
      seat: { id: "codex" },
      scope: { write: ["src/**"] },
      checks: ["true"],
    },
  ],
}).lines;

function run(overrides: Partial<RunView> = {}): RunView {
  return {
    runId: "api-1",
    lineId: "api",
    seat: { id: "codex", model: "astra" },
    attempt: 1,
    status: "done",
    phase: "reporting",
    sessionId: null,
    lastTool: null,
    files: [],
    diffStat: null,
    exitCode: 0,
    usage: {},
    review: { verdict: "accept", notes: "good", by: { id: "claude" }, revision: REV },
    checks: { ok: true, summary: "passed", commands: ["true"], revision: REV },
    proof: null,
    approval: { by: { kind: "user" }, revision: REV, note: null },
    merged: null,
    mergedFiles: [],
    conflictFiles: [],
    dropReason: null,
    breaches: [],
    queuedSeq: 1,
    startedSeq: 2,
    updatedSeq: 3,
    queuedAt: "2026-09-12T10:00:00.000Z",
    startedAt: "2026-09-12T10:00:01.000Z",
    endedAt: "2026-09-12T10:03:00.000Z",
    updatedAt: "2026-09-12T10:03:00.000Z",
    ...overrides,
  };
}

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), "fanout-merge-"));
  mkdirSync(join(repo, "src"));
  writeFileSync(join(repo, "src", "app.ts"), "export const version = 1;\n");
  git(["init", "--quiet", "-b", "main"]);
  git(["config", "user.email", "owner@example.invalid"]);
  git(["config", "user.name", "Owner"]);
  git(["add", "-A"]);
  git(["commit", "--quiet", "-m", "seed"]);

  work = join(mkdtempSync(join(tmpdir(), "fanout-merge-work-")), "w");
  git(["worktree", "add", "--detach", "--quiet", work, "HEAD"]);
});

afterEach(() => {
  execFileSync("git", ["worktree", "remove", "--force", work], { cwd: repo, env, stdio: "ignore" });
  rmSync(repo, { recursive: true, force: true });
});

/** The agent's work, as a patch plus the files it created. */
function agentWork(): { patch: string; newFiles: string[] } {
  writeFileSync(join(work, "src", "app.ts"), "export const version = 2;\n");
  writeFileSync(join(work, "src", "csv.ts"), "export const toCsv = () => 'id\\n';\n");
  const patch = execFileSync("git", ["diff", "HEAD", "--"], { cwd: work, env, encoding: "utf8" });
  return { patch, newFiles: ["src/csv.ts"] };
}

const merge = (over: Partial<Parameters<typeof mergeRun>[0]> = {}) => {
  const { patch, newFiles } = agentWork();
  if (line === undefined) throw new Error("fixture");
  return mergeRun({
    repoRoot: repo,
    workspacePath: work,
    run: run(),
    line,
    revision: REV,
    patch,
    newFiles,
    ...over,
  });
};

describe("merging work the gate allowed", () => {
  it("applies the changes and the new files, and commits them", async () => {
    const outcome = await merge();

    expect(outcome.kind).toBe("merged");
    expect(readFileSync(join(repo, "src", "app.ts"), "utf8")).toContain("version = 2");
    expect(readFileSync(join(repo, "src", "csv.ts"), "utf8")).toContain("toCsv");
    if (outcome.kind === "merged") expect(outcome.files).toEqual(["src/app.ts", "src/csv.ts"]);
  });

  it("records who wrote it and who approved it, in the history itself", async () => {
    await merge();
    const message = git(["log", "-1", "--format=%B%an"]);

    expect(message).toContain("Built-by: codex (astra) via fanout");
    expect(message).toContain("Approved-by: the repository's owner");
    expect(message).toContain("Fanout-run: api-1");
  });

  it("names a policy that approved it, so a replay can audit the authority", async () => {
    await merge({
      run: run({ approval: { by: { kind: "policy", name: "docs-only" }, revision: REV, note: null } }),
    });
    expect(git(["log", "-1", "--format=%B"])).toContain('Approved-by: policy "docs-only"');
  });
});

describe("what it refuses", () => {
  const unchanged = (): string => git(["rev-parse", "HEAD"]).trim();

  it.each([
    ["nobody reviewed it", { review: null }],
    ["the checks did not pass", { checks: null }],
    ["nobody approved it", { approval: null }],
    ["the agent has not finished", { status: "running" as const }],
    ["it is already merged", { status: "merged" as const }],
  ])("refuses when %s, and changes nothing", async (_label, overrides) => {
    const before = unchanged();
    const outcome = await merge({ run: run(overrides) });

    expect(outcome.kind).toBe("refused");
    expect(unchanged()).toBe(before);
    expect(git(["status", "--porcelain"])).toBe("");
  });

  /*
   * The reason every step of the gate records a revision. Each of those approvals really happened — about a
   * different diff. Merging this one would be merging work that nobody in that list ever looked at.
   */
  it("refuses work that moved after it was reviewed", async () => {
    const outcome = await merge({ revision: "b2".repeat(32) });

    expect(outcome.kind).toBe("refused");
    if (outcome.kind === "refused") expect(outcome.why.join(" ")).toContain("changed after");
  });

  it("refuses to merge into a tree with uncommitted changes it would touch", async () => {
    writeFileSync(join(repo, "src", "app.ts"), "export const version = 99; // mine, uncommitted\n");
    const outcome = await merge();

    expect(outcome.kind).toBe("refused");
    if (outcome.kind === "refused") expect(outcome.why.join(" ")).toContain("uncommitted changes");
    // The owner's own work is still exactly where they left it.
    expect(readFileSync(join(repo, "src", "app.ts"), "utf8")).toContain("mine, uncommitted");
  });

  it("does not mind uncommitted changes somewhere it will not touch", async () => {
    writeFileSync(join(repo, "unrelated.md"), "notes\n");
    expect((await merge()).kind).toBe("merged");
    expect(existsSync(join(repo, "unrelated.md"))).toBe(true);
  });
});

describe("when the work disagrees with the repository", () => {
  it("reports a conflict and rolls the whole attempt back", async () => {
    const { patch, newFiles } = agentWork();
    // Someone else changed the same line and committed it while the run was working.
    writeFileSync(join(repo, "src", "app.ts"), "export const version = 3; // theirs\n");
    git(["commit", "--quiet", "-am", "meanwhile"]);
    const before = git(["rev-parse", "HEAD"]).trim();
    if (line === undefined) throw new Error("fixture");

    const outcome = await mergeRun({
      repoRoot: repo,
      workspacePath: work,
      run: run(),
      line,
      revision: REV,
      patch,
      newFiles,
    });

    expect(outcome.kind).toBe("conflict");
    // Nothing half-applied: no commit, no stray new file, no conflict markers left in the tree.
    expect(git(["rev-parse", "HEAD"]).trim()).toBe(before);
    expect(git(["status", "--porcelain"])).toBe("");
    expect(existsSync(join(repo, "src", "csv.ts"))).toBe(false);
    expect(readFileSync(join(repo, "src", "app.ts"), "utf8")).toContain("theirs");
  });

  it("refuses to overwrite a file someone else created meanwhile", async () => {
    const { patch, newFiles } = agentWork();
    writeFileSync(join(repo, "src", "csv.ts"), "export const mine = true;\n");
    git(["add", "-A"]);
    git(["commit", "--quiet", "-m", "I wrote it first"]);
    if (line === undefined) throw new Error("fixture");

    const outcome = await mergeRun({
      repoRoot: repo,
      workspacePath: work,
      run: run(),
      line,
      revision: REV,
      patch,
      newFiles,
    });

    expect(outcome.kind).toBe("conflict");
    expect(readFileSync(join(repo, "src", "csv.ts"), "utf8")).toContain("mine");
  });
});

describe("reading a patch", () => {
  it("names every file it changes", () => {
    const patch = "--- a/src/a.ts\n+++ b/src/a.ts\n@@\n-1\n+2\n--- a/b.ts\n+++ b/b.ts\n@@\n+x\n";
    expect(filesInPatch(patch)).toEqual(["b.ts", "src/a.ts"]);
  });

  it("does not count a deletion's /dev/null as a file", () => {
    expect(filesInPatch("--- a/gone.ts\n+++ /dev/null\n")).toEqual([]);
  });
});
