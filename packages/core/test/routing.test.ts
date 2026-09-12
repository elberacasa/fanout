import { describe, expect, it } from "vitest";
import {
  EMPTY_POLICY,
  routeLine,
  SeatPolicy,
  unavailable,
  type SeatHeadroom,
  type SeatInfo,
} from "../src/index.ts";

/*
 * Routing has to be explainable or it is not trustworthy: a mission that quietly swapped a model would hide the
 * one fact that changes the result. Every answer here carries a reason a person could act on.
 */

const NOW = new Date("2026-09-12T12:00:00Z");

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

const limited = (message: string, resetsAt: string | null = null): SeatHeadroom => ({
  limited: { message, at: "2026-09-12T11:00:00Z", resetsAt },
  windows: {},
});

describe("why a seat cannot take work", () => {
  it.each([
    ["it is not installed", { version: null, supported: false }, "not installed"],
    ["its version is not one we verified", { supported: false }, "outside what its adapter"],
    ["it is not signed in", { signedIn: "no" as const }, "not signed in"],
  ])("says so when %s", (_label, overrides, expected) => {
    expect(unavailable(seat("codex", overrides), EMPTY_POLICY, undefined, NOW)).toContain(expected);
  });

  /*
   * Grok and Kimi have no status command at all. Refusing every seat that cannot report its own sign-in would
   * make them unusable even when the plan asked for them by name — the person writing the plan chose that seat,
   * and we find out by running it.
   */
  it("keeps a seat the plan asked for even when its CLI cannot report sign-in", () => {
    expect(unavailable(seat("grok", { signedIn: "unknown" }), EMPTY_POLICY, undefined, NOW)).toBeNull();
  });

  it("will not fall back onto one, because that spend would be our guess and not their choice", () => {
    const why = unavailable(seat("grok", { signedIn: "unknown" }), EMPTY_POLICY, undefined, NOW, true);
    expect(why).toContain("not the seat you asked for");
  });

  it("says so when the owner switched it off, and repeats their own reason", () => {
    const policy = SeatPolicy.parse({ version: 1, seats: { codex: { posture: "off" } } });
    expect(unavailable(seat("codex"), policy, undefined, NOW)).toContain("you set");
  });

  it("quotes the seat's own words when it has run out", () => {
    const why = unavailable(seat("codex"), EMPTY_POLICY, limited("You've reached your usage limit"), NOW);
    expect(why).toContain("You've reached your usage limit");
  });

  /*
   * A limit that has passed its reset is not a limit. Believing an expired one forever would strand a seat that
   * came back an hour ago, and the reset is the seat's own word rather than our arithmetic.
   */
  it("stops believing a limit once the seat's own reset time has passed", () => {
    const expired = limited("rate limited", "2026-09-12T11:30:00Z");
    expect(unavailable(seat("codex"), EMPTY_POLICY, expired, NOW)).toBeNull();
  });

  it("keeps believing one whose reset is still ahead", () => {
    const active = limited("rate limited", "2026-09-12T12:30:00Z");
    expect(unavailable(seat("codex"), EMPTY_POLICY, active, NOW)).not.toBeNull();
  });

  it("keeps believing one with no reset at all, since nothing said it was over", () => {
    expect(unavailable(seat("codex"), EMPTY_POLICY, limited("out of credit"), NOW)).not.toBeNull();
  });
});

describe("choosing a seat for a line", () => {
  const crew = [seat("codex"), seat("claude"), seat("grok")];

  it("keeps the plan's own choice when it can work", () => {
    expect(routeLine({ wanted: "codex", seats: crew, policy: EMPTY_POLICY, headroom: {}, now: NOW })).toEqual(
      {
        kind: "keep",
        seat: "codex",
      },
    );
  });

  it("moves the work when the chosen seat has run out, and says which and why", () => {
    const routing = routeLine({
      wanted: "codex",
      seats: crew,
      policy: EMPTY_POLICY,
      headroom: { codex: limited("You've reached your usage limit") },
      now: NOW,
    });

    expect(routing.kind).toBe("move");
    if (routing.kind === "move") {
      expect(routing.from).toBe("codex");
      expect(routing.reason).toContain("usage limit");
    }
  });

  it("prefers the seat the owner marked preferred", () => {
    const policy = SeatPolicy.parse({ version: 1, seats: { grok: { posture: "preferred" } } });
    const routing = routeLine({
      wanted: "codex",
      seats: crew,
      policy,
      headroom: { codex: limited("out") },
      now: NOW,
    });
    expect(routing.kind === "move" && routing.seat).toBe("grok");
  });

  it("never moves work onto a seat the owner switched off, however free it is", () => {
    const policy = SeatPolicy.parse({
      version: 1,
      seats: { claude: { posture: "off" }, grok: { posture: "off" } },
    });
    const routing = routeLine({
      wanted: "codex",
      seats: crew,
      policy,
      headroom: { codex: limited("out") },
      now: NOW,
    });
    expect(routing.kind).toBe("stuck");
  });

  it("says out loud when the seat it fell back to is one you asked it to spare", () => {
    const policy = SeatPolicy.parse({
      version: 1,
      seats: { claude: { posture: "off" }, grok: { posture: "sparing", note: "cheapest plan" } },
    });
    const routing = routeLine({
      wanted: "codex",
      seats: crew,
      policy,
      headroom: { codex: limited("out") },
      now: NOW,
    });

    expect(routing.kind === "move" && routing.reason).toContain("sparing");
    expect(routing.kind === "move" && routing.reason).toContain("cheapest plan");
  });

  it("gets stuck rather than inventing a seat that is not there", () => {
    const routing = routeLine({
      wanted: "kimi",
      seats: [seat("codex", { signedIn: "no" })],
      policy: EMPTY_POLICY,
      headroom: {},
      now: NOW,
    });

    expect(routing.kind).toBe("stuck");
    if (routing.kind === "stuck") expect(routing.reason).toContain("not a seat on this machine");
  });

  /*
   * A mission that picks a different seat each run is a mission whose results cannot be compared. Stability is
   * worth more here than any cleverness about which seat is momentarily faster.
   */
  it("chooses the same seat every time from the same facts", () => {
    const input = {
      wanted: "codex",
      seats: crew,
      policy: EMPTY_POLICY,
      headroom: { codex: limited("out") },
      now: NOW,
    };
    const answers = [routeLine(input), routeLine(input), routeLine(input)];
    expect(new Set(answers.map((a) => (a.kind === "move" ? a.seat : a.kind))).size).toBe(1);
  });

  it("never infers cost from a plan name", () => {
    const onMax = [seat("codex"), seat("claude", { plan: { name: "max", source: "detected" } })];
    const onFree = [seat("codex"), seat("claude", { plan: { name: "free", source: "detected" } })];
    const input = { wanted: "codex", policy: EMPTY_POLICY, headroom: { codex: limited("out") }, now: NOW };

    expect(routeLine({ ...input, seats: onMax })).toEqual(routeLine({ ...input, seats: onFree }));
  });
});
