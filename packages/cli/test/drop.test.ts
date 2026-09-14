import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Ledger, project, type FanoutEventInput } from "fanout-core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { main } from "../src/main.ts";

/*
 * Writing off work you have decided not to do.
 *
 * `fanout owed` runs after every turn and is right to keep asking about a run that finished and was never
 * reviewed — it really is waiting, and nothing merges without it. The problem was that there was no answer.
 * Merging concludes a run, reworking concludes it, a dead supervisor concludes it; "I am not going to bother"
 * had no way to be said, so the reminder was permanent and people learn to ignore a permanent reminder.
 */

const M = "demo";
let home: string;

const events = (runStatus: "done" | "merged" | "running"): FanoutEventInput[] => [
  {
    type: "mission.created",
    missionId: M,
    goal: "Do the thing",
    repo: { root: "/work", baseCommit: "0".repeat(40) },
    limits: { maxParallel: 2, timeoutMinutes: 30 },
  },
  { type: "run.queued", missionId: M, runId: "api-1", lineId: "api", seat: { id: "codex" }, attempt: 1 },
  { type: "run.started", missionId: M, runId: "api-1", workdir: "/w", argv: ["codex"], owner: process.pid },
  ...(runStatus === "running"
    ? []
    : [
        {
          type: "run.finished" as const,
          missionId: M,
          runId: "api-1",
          status: "done" as const,
          exitCode: 0,
        },
      ]),
];

const seed = (events: readonly FanoutEventInput[]): void => {
  const ledger = Ledger.open(join(home, "ledger.db"));
  ledger.appendAll(events);
  ledger.close();
};

const runOf = (runId: string) => {
  const ledger = Ledger.open(join(home, "ledger.db"));
  const found = project(ledger.read()).missions[M]?.runs[runId];
  ledger.close();
  return found;
};

const run = async (args: readonly string[]) => {
  let out = "";
  let err = "";
  const code = await main(args, {
    out: (text) => (out += text),
    err: (text) => (err += text),
    env: { ...process.env, FANOUT_HOME: home },
  });
  return { code, out, err };
};

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "fanout-drop-"));
});
afterEach(() => {
  rmSync(home, { recursive: true, force: true });
});

describe("fanout drop", () => {
  it("writes off a finished run nobody is going to review", async () => {
    seed(events("done"));

    const { code, out } = await run(["drop", "api-1", "superseded by the rewrite"]);

    expect(code).toBe(0);
    expect(out).toContain("Dropped api-1");
    expect(runOf("api-1")?.status).toBe("dropped");
  });

  /*
   * The distinction the ledger must not blur. `reconcile` drops runs whose supervisor died — an inference about
   * a process. This is a person deciding. Six months later that difference is the whole value of the record.
   */
  it("records that a person decided, and why", async () => {
    seed(events("done"));

    await run(["drop", "api-1", "superseded by the rewrite"]);

    expect(runOf("api-1")?.dropReason).toContain("written off by the owner");
    expect(runOf("api-1")?.dropReason).toContain("superseded by the rewrite");
  });

  it("refuses without a reason, because an unexplained write-off reads as a mistake later", async () => {
    seed(events("done"));

    const { code, err } = await run(["drop", "api-1"]);

    expect(code).toBe(64);
    expect(err).toContain("say why");
    expect(runOf("api-1")?.status).toBe("done");
  });

  it("refuses a run that is still going, rather than writing something the machine contradicts", async () => {
    seed(events("running"));

    const { code, err } = await run(["drop", "api-1", "changed my mind"]);

    expect(code).toBe(1);
    expect(err).toContain("still running");
    expect(runOf("api-1")?.status).toBe("running");
  });

  it("says so plainly when the run does not exist", async () => {
    seed(events("done"));

    const { code, err } = await run(["drop", "nope-9", "whatever"]);

    expect(code).toBe(1);
    expect(err).toContain('no run "nope-9"');
  });

  it("is safe to run twice", async () => {
    seed(events("done"));
    await run(["drop", "api-1", "superseded"]);

    const { code, out } = await run(["drop", "api-1", "superseded"]);

    expect(code).toBe(0);
    expect(out).toContain("already dropped");
  });
});
