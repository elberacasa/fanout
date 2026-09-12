import { describe, expect, it } from "vitest";
import { EMPTY_POLICY, SeatPolicy, stanceFor, usableSeats, type SeatInfo } from "../src/index.ts";

/*
 * Posture is the one thing about a seat that only the owner knows: which subscription they would rather not spend.
 * These tests hold the line between that preference and what detection happens to find today.
 */

const seat = (overrides: Partial<SeatInfo> = {}): SeatInfo => ({
  id: "codex",
  displayName: "OpenAI Codex",
  binary: "codex",
  version: "0.154.0",
  supported: true,
  signedIn: "yes",
  models: [],
  efforts: [],
  billing: "subscription",
  plan: null,
  ...overrides,
});

describe("stanceFor", () => {
  it("uses a seat the owner has said nothing about", () => {
    const stance = stanceFor(seat(), EMPTY_POLICY);
    expect(stance).toMatchObject({ posture: "normal", source: "default", usable: true });
  });

  it("leaves Claude off until it is asked for, and says why", () => {
    const stance = stanceFor(seat({ id: "claude", displayName: "Claude Code" }), EMPTY_POLICY);
    expect(stance.posture).toBe("off");
    expect(stance.usable).toBe(false);
    expect(stance.reason).toContain("same subscription");
  });

  it("lets the owner turn Claude on, which is the whole point of opt-in", () => {
    const policy = SeatPolicy.parse({ version: 1, seats: { claude: { posture: "normal" } } });
    expect(stanceFor(seat({ id: "claude" }), policy)).toMatchObject({
      posture: "normal",
      source: "declared",
      usable: true,
    });
  });

  it("keeps the preference when the CLI is not available, rather than rewriting it", () => {
    const policy = SeatPolicy.parse({ version: 1, seats: { codex: { posture: "preferred" } } });
    const stance = stanceFor(seat({ signedIn: "no" }), policy);

    // Still preferred — the owner has not changed their mind, the laptop has changed its state.
    expect(stance.posture).toBe("preferred");
    expect(stance.usable).toBe(false);
  });

  it.each([
    ["an unsupported version", { supported: false }],
    ["a CLI that cannot say whether it is signed in", { signedIn: "unknown" as const }],
    ["a CLI that is not installed", { version: null, supported: false }],
  ])("will not use a seat with %s", (_label, overrides) => {
    expect(stanceFor(seat(overrides), EMPTY_POLICY).usable).toBe(false);
  });

  it("hands back the owner's own note so a past decision explains itself", () => {
    const policy = SeatPolicy.parse({
      version: 1,
      seats: { grok: { posture: "sparing", note: "cheapest plan, save it for overflow" } },
    });
    expect(stanceFor(seat({ id: "grok" }), policy).note).toBe("cheapest plan, save it for overflow");
  });

  /*
   * The policy is a plain JSON object read off disk, so a seat id like "constructor" or "__proto__" must not
   * resolve to something inherited from Object.prototype and become a posture we never wrote.
   */
  it("is not fooled by a seat named after an inherited property", () => {
    const stance = stanceFor(seat({ id: "constructor" }), EMPTY_POLICY);
    expect(stance).toMatchObject({ posture: "normal", source: "default" });
  });

  it("never infers cost from a plan name, because we do not know prices", () => {
    const onMax = stanceFor(seat({ plan: { name: "max", source: "detected" } }), EMPTY_POLICY);
    const onFree = stanceFor(seat({ plan: { name: "free", source: "detected" } }), EMPTY_POLICY);
    expect(onMax.posture).toBe(onFree.posture);
  });
});

describe("usableSeats", () => {
  it("offers the willing seats first and leaves out the ones that are off", () => {
    const policy = SeatPolicy.parse({
      version: 1,
      seats: {
        grok: { posture: "sparing" },
        claude: { posture: "preferred" },
        kimi: { posture: "off" },
      },
    });
    const seats = [seat({ id: "grok" }), seat({ id: "codex" }), seat({ id: "claude" }), seat({ id: "kimi" })];

    expect(usableSeats(seats, policy).map((s) => s.id)).toEqual(["claude", "codex", "grok"]);
  });

  it("returns nothing rather than a fallback when every seat is unavailable", () => {
    expect(usableSeats([seat({ signedIn: "no" })], EMPTY_POLICY)).toEqual([]);
  });
});

describe("the policy file", () => {
  it("refuses a posture it does not know instead of falling back to one", () => {
    const result = SeatPolicy.safeParse({ version: 1, seats: { codex: { posture: "cheap" } } });
    expect(result.success).toBe(false);
  });

  it("refuses a file from a future version rather than guessing its meaning", () => {
    expect(SeatPolicy.safeParse({ version: 2, seats: {} }).success).toBe(false);
  });

  it("refuses stray keys, so a typo is reported and not silently ignored", () => {
    expect(SeatPolicy.safeParse({ version: 1, seats: {}, preferred: "codex" }).success).toBe(false);
    expect(
      SeatPolicy.safeParse({ version: 1, seats: { codex: { posture: "normal", stance: "x" } } }).success,
    ).toBe(false);
  });
});
