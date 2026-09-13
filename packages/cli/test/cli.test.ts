import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Ledger } from "fanout-core";
import type { CommandResult } from "fanout-daemon";
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
    binary === "codex"
      ? ok("Logged in using ChatGPT")
      : // What a signed-out Claude actually prints. An empty answer would be "unknown", not "no", and saying
        // "not signed in" on the strength of silence is the failure this fixture used to hide.
        { stdout: JSON.stringify({ loggedIn: false }), stderr: "", exitCode: 1 },
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

  it("shows the plan a CLI reports, and where the answer came from", async () => {
    // Only Claude Code exposes a subscription tier, and only when signed in.
    const signedInClaude = (binary: string, args: readonly string[]): Promise<CommandResult> => {
      if (binary !== "claude") return Promise.reject(new Error(`spawn ${binary} ENOENT`));
      if (args[0] === "--version") return Promise.resolve(ok("2.1.269"));
      return Promise.resolve(ok(JSON.stringify({ loggedIn: true, subscriptionType: "max" })));
    };

    expect(await main(["status"], io({ execute: signedInClaude }))).toBe(0);
    expect(printed()).toMatch(/Claude Code\s+2\.1\.269\s+signed in\s+max \(detected\)/);
  });

  it("leaves the plan column empty rather than guessing for a CLI that has none", async () => {
    await main(["status"], io());
    // Codex is signed in but reports no tier; the row must not invent one or borrow another seat's.
    expect(printed()).toMatch(/OpenAI Codex\s+0\.154\.0\s+signed in\s*$/m);
  });

  it("shows a posture the owner set, and stays quiet about the ones they did not", async () => {
    await main(["seat", "grok", "sparing", "cheapest", "plan"], io());
    out = [];
    await main(["status"], io());

    expect(printed()).toMatch(/Grok Build[^\n]*sparing/);
    // "normal" is every seat nobody has decided about; printing it down the table would bury the real answers.
    expect(printed()).not.toContain("normal");
  });

  it("counts a seat as ready only when the owner is willing to spend it", async () => {
    await main(["status"], io());
    expect(printed()).toContain("(1 ready)");

    out = [];
    await main(["seat", "codex", "off"], io());
    out = [];
    await main(["status"], io());
    expect(printed()).toContain("(0 ready)");
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

describe("fanout seat", () => {
  it("records a posture with the owner's reason", async () => {
    expect(await main(["seat", "grok", "sparing", "cheapest", "plan"], io())).toBe(0);
    expect(printed()).toContain("grok is now sparing — cheapest plan");
  });

  it("survives a restart, because the point is not to be asked twice", async () => {
    await main(["seat", "grok", "off"], io());
    out = [];
    await main(["status"], io());
    expect(printed()).toMatch(/Grok Build[^\n]*off/);
  });

  it.each([
    ["no arguments at all", []],
    ["a seat but no posture", ["grok"]],
    ["a posture we do not have", ["grok", "cheap"]],
    ["a seat we do not have", ["gemini", "normal"]],
  ])("refuses %s, and says what it wanted", async (_label, args) => {
    expect(await main(["seat", ...args], io())).toBe(64);
    expect(err.join("")).toContain("fanout:");
  });

  it("will not write on top of a policy file it could not read", async () => {
    await main(["seat", "grok", "off"], io());
    writeFileSync(join(home, "seats.json"), "{{{ not json");
    err = [];

    // Overwriting here would silently discard every preference the owner had set.
    expect(await main(["seat", "codex", "preferred"], io())).toBe(65);
    expect(err.join("")).toContain("before changing a seat");
  });

  it("warns on status when the policy cannot be read, instead of looking normal", async () => {
    writeFileSync(join(home, "seats.json"), "{{{ not json");
    await main(["status"], io());
    expect(err.join("")).toContain("falls back to its default");
  });
});
