import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { SeatInfo } from "fanout-core";
import { chooseSeat } from "../src/policy/route.ts";
import { POLICY_FILE } from "../src/policy/seats.ts";

/*
 * What we are allowed to decide, as opposed to what we would decide.
 *
 * Core's `routeLine` is tested on its ordering rules. Everything here is about the cases where we must not reach
 * those rules at all — and each one resolves the same way, by keeping the seat the plan named, because that is the
 * outcome that fails in front of the owner instead of on their bill.
 */

const seat = (id: string, overrides: Partial<SeatInfo> = {}): SeatInfo => ({
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
  ...overrides,
});

const NOW = new Date("2026-09-12T15:00:00Z");
let home: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "fanout-route-"));
});
afterEach(() => {
  rmSync(home, { recursive: true, force: true });
});

describe("choosing a seat on this machine", () => {
  it("keeps the plan's seat while detection has not answered", () => {
    expect(chooseSeat("codex", { home, crew: [], headroom: {}, now: NOW })).toEqual({
      kind: "keep",
      seat: "codex",
    });
  });

  /*
   * The reason this module exists. `readSeatPolicy` returns defaults *and* a problem for a damaged file, and a
   * caller that reads only the defaults would route as though the owner had set no preferences — which is exactly
   * how work ends up on a seat they switched off. Mutation-checked: dropping the `problem` guard moves this line.
   */
  it("moves nothing when the owner's preferences could not be read", () => {
    writeFileSync(join(home, POLICY_FILE), "{ this is not json");

    const routing = chooseSeat("codex", {
      home,
      crew: [seat("codex", { signedIn: "no" }), seat("claude")],
      headroom: {},
      now: NOW,
    });

    expect(routing).toEqual({ kind: "keep", seat: "codex" });
  });

  it("routes normally once the preferences read cleanly", () => {
    // Claude is off until asked for (DECISIONS 0009), so it takes a declared posture to become a candidate.
    writeFileSync(
      join(home, POLICY_FILE),
      JSON.stringify({ version: 1, seats: { claude: { posture: "normal" } } }),
    );

    const routing = chooseSeat("codex", {
      home,
      crew: [seat("codex", { signedIn: "no" }), seat("claude")],
      headroom: {},
      now: NOW,
    });

    expect(routing).toMatchObject({ kind: "move", seat: "claude", from: "codex" });
    expect((routing as { reason: string }).reason).toContain("not signed in");
  });

  it("says so, in words, when nothing else can take the line", () => {
    const routing = chooseSeat("codex", {
      home,
      crew: [seat("codex", { signedIn: "no" })],
      headroom: {},
      now: NOW,
    });

    expect(routing).toMatchObject({ kind: "stuck", from: "codex" });
    expect((routing as { reason: string }).reason).toContain("no other seat can take it");
  });
});
