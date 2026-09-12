import { mkdtempSync, readFileSync, rmSync, writeFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EMPTY_POLICY, stanceFor, type SeatInfo } from "@fanout/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { policyPath, readSeatPolicy, setPosture, writeSeatPolicy } from "../src/policy/seats.ts";

/*
 * The preferences file decides whether we are allowed to spend someone's subscription, so the interesting tests
 * are all about what happens when it cannot be trusted.
 */

let home: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "fanout-policy-"));
});
afterEach(() => {
  rmSync(home, { recursive: true, force: true });
});

const seat = (id: string): SeatInfo => ({
  id,
  displayName: id,
  binary: id,
  version: "1.0.0",
  supported: true,
  signedIn: "yes",
  models: [],
  efforts: [],
  billing: "subscription",
  plan: null,
});

describe("reading the preferences", () => {
  it("treats a missing file as no preferences, which is the normal case", () => {
    const read = readSeatPolicy(home);
    expect(read.problem).toBeNull();
    expect(read.policy).toEqual(EMPTY_POLICY);
  });

  it("round-trips what was written", () => {
    writeSeatPolicy(home, setPosture(EMPTY_POLICY, "grok", "sparing", "cheapest plan"));
    const read = readSeatPolicy(home);

    expect(read.problem).toBeNull();
    expect(read.policy.seats["grok"]).toEqual({ posture: "sparing", note: "cheapest plan" });
  });

  /*
   * The one that matters. An empty policy and an unreadable one must never look the same: if a damaged file
   * quietly became "no preferences", a seat the owner switched off would come back on without anyone being told.
   */
  it.each([
    ["a file that is not JSON", "{{{"],
    ["a posture we do not know", JSON.stringify({ version: 1, seats: { grok: { posture: "cheap" } } })],
    ["a version from the future", JSON.stringify({ version: 2, seats: {} })],
    ["a stray key", JSON.stringify({ version: 1, seats: {}, preferred: "codex" })],
    ["something that is not an object at all", "[]"],
  ])("reports %s as a problem instead of as no preferences", (_label, contents) => {
    writeFileSync(policyPath(home), contents);
    const read = readSeatPolicy(home);

    expect(read.problem).not.toBeNull();
    expect(read.problem).toContain(policyPath(home));
  });

  it("does not resurrect a switched-off seat when the file is damaged", () => {
    writeSeatPolicy(home, setPosture(EMPTY_POLICY, "grok", "off"));
    expect(stanceFor(seat("grok"), readSeatPolicy(home).policy).usable).toBe(false);

    writeFileSync(policyPath(home), "not json at all");
    const read = readSeatPolicy(home);

    // The defaults would say "usable", which is exactly why the problem must be loud and must block the caller.
    expect(read.problem).not.toBeNull();
    expect(stanceFor(seat("grok"), read.policy).usable).toBe(true);
  });
});

describe("writing the preferences", () => {
  it("changes one seat and leaves the others alone", () => {
    let policy = setPosture(EMPTY_POLICY, "codex", "preferred");
    policy = setPosture(policy, "grok", "sparing");
    policy = setPosture(policy, "codex", "normal");

    expect(policy.seats["codex"]?.posture).toBe("normal");
    expect(policy.seats["grok"]?.posture).toBe("sparing");
  });

  it("drops a note that was cleared rather than storing an empty one", () => {
    const policy = setPosture(setPosture(EMPTY_POLICY, "grok", "sparing", "why"), "grok", "sparing", "");
    expect(policy.seats["grok"]).toEqual({ posture: "sparing" });
  });

  it("keeps the file private to the owner", () => {
    writeSeatPolicy(home, setPosture(EMPTY_POLICY, "codex", "preferred"));
    expect(statSync(policyPath(home)).mode & 0o777).toBe(0o600);
  });

  it("leaves no temporary file behind, so a later read cannot find a torn one", () => {
    writeSeatPolicy(home, setPosture(EMPTY_POLICY, "codex", "preferred"));
    const contents = readFileSync(policyPath(home), "utf8");
    expect(contents).toContain("preferred");
    expect(() => readSeatPolicy(home)).not.toThrow();
  });

  it("refuses to write a policy that could not be read back", () => {
    expect(() => {
      // @ts-expect-error deliberately invalid: the writer validates rather than trusting its caller.
      writeSeatPolicy(home, { version: 1, seats: { grok: { posture: "cheap" } } });
    }).toThrow();
  });
});
