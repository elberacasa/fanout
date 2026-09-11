import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createSafetyDependencies } from "../src/safety/dependencies.ts";

/* The two facts the gate takes from the repository, read from real git. */

let dir: string;
let repo: string;
let baseCommit: string;

function run(args: string[]): string {
  return execFileSync("git", args, { cwd: repo, encoding: "utf8" });
}

function write(path: string, content: string): void {
  const full = join(repo, path);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, content, "utf8");
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "fanout-safety-deps-"));
  repo = join(dir, "repo");
  mkdirSync(repo);
  run(["init", "--quiet", "-b", "main"]);
  run(["config", "user.email", "crew@example.invalid"]);
  run(["config", "user.name", "Fanout tests"]);
  write("src/api/csv.ts", "export const csv = 1;\n");
  write("README.md", "# sample\n");
  run(["add", "-A"]);
  run(["commit", "--quiet", "-m", "seed"]);
  baseCommit = run(["rev-parse", "HEAD"]).trim();
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("deniedFiles from a real repository", () => {
  it("finds nothing in a clean repository", async () => {
    const deps = createSafetyDependencies({ repoRoot: repo });
    expect(await deps.deniedFiles(baseCommit)).toEqual([]);
  });

  it("finds what the repository tracks, wherever it sits", async () => {
    write(".env", "SECRET=invented\n");
    write("packages/app/.env.production", "SECRET=invented\n");
    write("deploy/keys/server.pem", "invented\n");
    write("docs/notes (draft).md", "# fine\n");
    run(["add", "-A"]);
    run(["commit", "--quiet", "-m", "add files"]);
    const commit = run(["rev-parse", "HEAD"]).trim();

    const denied = await createSafetyDependencies({ repoRoot: repo }).deniedFiles(commit);
    expect([...denied].sort()).toEqual([".env", "deploy/keys/server.pem", "packages/app/.env.production"]);
  });

  it("honours a deny-list the user narrowed on purpose", async () => {
    write(".env", "SECRET=invented\n");
    run(["add", "-A"]);
    run(["commit", "--quiet", "-m", "add .env"]);
    const commit = run(["rev-parse", "HEAD"]).trim();

    const deps = createSafetyDependencies({ repoRoot: repo, denyList: ["**/*.pem"] });
    expect(await deps.deniedFiles(commit)).toEqual([]);
  });
});

describe("repositoryState", () => {
  it("reports a clean repository at its head", async () => {
    const state = await createSafetyDependencies({ repoRoot: repo }).repositoryState();
    expect(state).toEqual({ head: baseCommit, dirty: [] });
  });

  it("reports modified, untracked and renamed paths, including the name a rename came from", async () => {
    write("src/api/csv.ts", "export const csv = 2;\n");
    write("src/api/new.ts", "export const fresh = 1;\n");
    run(["mv", "README.md", "READ ME.md"]);

    const state = await createSafetyDependencies({ repoRoot: repo }).repositoryState();
    expect(state.head).toBe(baseCommit);
    expect([...state.dirty].sort()).toEqual(["READ ME.md", "README.md", "src/api/csv.ts", "src/api/new.ts"]);
  });
});
