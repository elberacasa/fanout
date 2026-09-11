import { describe, expect, it } from "vitest";
import { EventStamp, FanoutEvent } from "../src/index.ts";
import { SHA, samples } from "./fixtures/events.ts";

describe("FanoutEvent", () => {
  it("has a valid sample for every event type", () => {
    const declared = FanoutEvent.options.map((option) => option.shape.type.value).sort();
    expect(Object.keys(samples).sort()).toEqual(declared);
    for (const sample of Object.values(samples)) {
      const result = FanoutEvent.safeParse(sample);
      expect(result.error, sample.type).toBeUndefined();
    }
  });

  it("fills defaults", () => {
    const parsed = FanoutEvent.parse({ type: "run.tool", missionId: "m", runId: "r", tool: "read" });
    expect(parsed).toMatchObject({ files: [] });
  });

  it.each([
    ["an unknown type", { type: "run.exploded", missionId: "m" }],
    ["an unknown key", { ...samples["run.progress"], secret: "x" }],
    ["a missing mission id", { type: "run.progress", runId: "r", phase: "coding" }],
    ["a bad run id", { ...samples["run.progress"], runId: "Run 1" }],
    ["an unknown phase", { ...samples["run.progress"], phase: "dreaming" }],
    ["a short commit id", { ...samples["mission.created"], repo: { root: "/r", baseCommit: "abc123" } }],
    ["an attempt past the rework limit", { ...samples["run.queued"], attempt: 4 }],
    ["negative usage", { ...samples["run.usage"], amount: -1 }],
    ["a merge with no files", { ...samples["merge.applied"], files: [] }],
  ])("rejects %s", (_, input) => {
    expect(FanoutEvent.safeParse(input).success).toBe(false);
  });

  it("accepts SHA-256 commit ids", () => {
    const repo = { root: "/r", baseCommit: SHA.repeat(2).slice(0, 64) };
    expect(FanoutEvent.safeParse({ ...samples["mission.created"], repo }).success).toBe(true);
  });

  it("keeps the safety report honest", () => {
    const failing = { id: "scopes", ok: false, severity: "block", message: "overlap" } as const;
    const warning = { id: "network", ok: false, severity: "warn", message: "network stays on" } as const;
    const report = samples["safety.report"];
    expect(FanoutEvent.safeParse({ ...report, ok: true, checks: [failing] }).success).toBe(false);
    expect(FanoutEvent.safeParse({ ...report, ok: false, checks: [failing] }).success).toBe(true);
    expect(FanoutEvent.safeParse({ ...report, ok: true, checks: [warning] }).success).toBe(true);
    expect(FanoutEvent.safeParse({ ...report, ok: false, checks: [warning] }).success).toBe(false);
  });

  it("requires a passing proof to name a test that failed on the old code", () => {
    const proof = samples["proof.done"];
    expect(FanoutEvent.safeParse({ ...proof, failedOnOld: [] }).success).toBe(false);
    expect(FanoutEvent.safeParse({ ...proof, ok: false, failedOnOld: [] }).success).toBe(true);
  });
});

describe("EventStamp", () => {
  const stamp = { v: 1, id: "2f6c7b1e-4a52-4c3e-9a0f-4f1d7c9e8b21", seq: 1, ts: "2026-09-11T17:00:00.000Z" };

  it("accepts a ledger stamp", () => {
    expect(EventStamp.safeParse(stamp).success).toBe(true);
  });

  it.each([
    ["a future version", { ...stamp, v: 2 }],
    ["a bad id", { ...stamp, id: "not-a-uuid" }],
    ["seq zero", { ...stamp, seq: 0 }],
    ["a local time", { ...stamp, ts: "2026-09-11 17:00" }],
  ])("rejects %s", (_, input) => {
    expect(EventStamp.safeParse(input).success).toBe(false);
  });
});
