import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Ledger } from "@fanout/core";
import type { CommandResult } from "@fanout/daemon";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { main, type Io } from "../src/main.ts";

/*
 * The CLI is what a person sees first, so these tests are about what it says — especially when it does not know.
 */

let home: string;
let out: string[];
let err: string[];

const ok = (stdout: string): CommandResult => ({ stdout, stderr: "", exitCode: 0 });

/** Pretends Codex is signed in, Claude is signed out, and Grok is not installed. */
const execute = (binary: string, args: readonly string[]): Promise<CommandResult> => {
  if (binary === "grok") return Promise.reject(new Error("spawn grok ENOENT"));
  if (args[0] === "--version")
    return Promise.resolve(ok(binary === "codex" ? "codex-cli 0.154.0" : "2.1.269"));
  return Promise.resolve(
    binary === "codex" ? ok("Logged in using ChatGPT") : { stdout: "", stderr: "", exitCode: 1 },
  );
};

function io(overrides: Partial<Io> = {}): Io {
  return {
    out: (text) => out.push(text),
    err: (text) => err.push(text),
    env: { FANOUT_HOME: home },
    execute,
    ...overrides,
  };
}

const printed = (): string => out.join("");

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "fanout-cli-"));
  out = [];
  err = [];
});

afterEach(() => {
  rmSync(home, { recursive: true, force: true });
});

describe("fanout help", () => {
  it("explains itself and says where everything lives", async () => {
    expect(await main(["help"], io())).toBe(0);
    expect(printed()).toContain("fanout status");
    expect(printed()).toContain("Nothing leaves your machine");
  });

  it("says so when a command does not exist, and does not pretend to succeed", async () => {
    expect(await main(["fly"], io())).toBe(64);
    expect(err.join("")).toContain('there is no "fly" command');
  });
});

describe("fanout status", () => {
  it("shows each seat, and never lets an unknown look like a yes", async () => {
    expect(await main(["status"], io())).toBe(0);
    const text = printed();

    expect(text).toContain("Crew on this machine (1 ready)");
    expect(text).toMatch(/OpenAI Codex\s+0\.154\.0\s+signed in/);
    expect(text).toMatch(/Claude Code\s+2\.1\.269\s+not signed in/);
    expect(text).toMatch(/Grok Build\s+not installed/);
  });

  it("says there are no missions yet rather than showing an empty table", async () => {
    await main(["status"], io());
    expect(printed()).toContain("No missions yet");
  });

  it("summarises the missions it finds", async () => {
    const ledger = Ledger.open(join(home, "ledger.db"));
    ledger.appendAll([
      {
        type: "mission.created",
        missionId: "csv-export",
        goal: "Add CSV export",
        repo: { root: "/work", baseCommit: "0".repeat(40) },
        limits: { maxParallel: 2, timeoutMinutes: 30 },
      },
      {
        type: "run.queued",
        missionId: "csv-export",
        runId: "api-1",
        lineId: "api",
        seat: { id: "codex" },
        attempt: 1,
      },
      { type: "run.started", missionId: "csv-export", runId: "api-1", workdir: "/w", argv: ["codex"] },
    ]);
    ledger.close();

    await main(["status"], io());
    expect(printed()).toMatch(/csv-export\s+running\s+1 run · 1 running/);
  });
});

describe("fanout clean", () => {
  const gitEnv = {
    PATH: process.env["PATH"] ?? "",
    HOME: process.env["HOME"] ?? "",
    GIT_CONFIG_NOSYSTEM: "1",
    LC_ALL: "C",
  };

  function repoWithWorkspace(): { repo: string; workspace: string; branch: string } {
    const repo = join(home, "repo");
    mkdirSync(repo);
    const run = (args: string[]): string =>
      execFileSync("git", args, { cwd: repo, encoding: "utf8", env: gitEnv });
    run(["init", "--quiet", "-b", "main"]);
    run(["config", "user.email", "crew@example.invalid"]);
    run(["config", "user.name", "Fanout tests"]);
    writeFileSync(join(repo, "a.txt"), "hello\n");
    run(["add", "-A"]);
    run(["commit", "--quiet", "-m", "seed"]);

    const branch = "fanout/csv-export/api-1";
    const workspace = join(home, "workspaces", "csv-export", "api-1");
    mkdirSync(join(home, "workspaces", "csv-export"), { recursive: true });
    run(["worktree", "add", "--quiet", "-b", branch, workspace, "HEAD"]);
    return { repo, workspace, branch };
  }

  it("removes the worktrees and branches a mission left, and nothing else", async () => {
    const { repo, workspace, branch } = repoWithWorkspace();
    const mine = "my-own-work";
    execFileSync("git", ["branch", mine], { cwd: repo, env: gitEnv });

    expect(await main(["clean"], io({ cwd: repo }))).toBe(0);

    expect(existsSync(workspace)).toBe(false);
    const branches = execFileSync("git", ["branch", "--list"], { cwd: repo, encoding: "utf8", env: gitEnv });
    expect(branches).not.toContain(branch);
    expect(branches).toContain(mine);
    expect(printed()).toContain("Your own branches were not touched");
  });

  it("says there is nothing to clean rather than pretending it did something", async () => {
    const { repo } = repoWithWorkspace();
    await main(["clean"], io({ cwd: repo }));
    out = [];
    expect(await main(["clean"], io({ cwd: repo }))).toBe(0);
    expect(printed()).toContain("Nothing to clean");
  });

  it("asks to be run inside a repository", async () => {
    expect(await main(["clean"], io({ cwd: home }))).toBe(64);
    expect(err.join("")).toContain("run this inside the repository");
  });
});

describe("fanout daemon", () => {
  it("listens on the loopback address, names its token, and stops when asked", async () => {
    let stop: (() => void) | undefined;
    const until = new Promise<void>((resolve) => {
      stop = resolve;
    });

    const run = main(["daemon"], io({ until }));
    await new Promise((resolve) => setTimeout(resolve, 150));

    const url = /listening on (http:\/\/127\.0\.0\.1:\d+)/.exec(printed())?.[1];
    expect(url).toBeDefined();
    const health = await fetch(`${url ?? ""}/health`);
    expect(await health.json()).toMatchObject({ ok: true });

    expect(printed()).toContain("/events?for=lead");
    expect(statSync(join(home, "token")).mode & 0o777).toBe(0o600);

    stop?.();
    expect(await run).toBe(0);
    expect(printed()).toContain("daemon stopped");
  });
});
