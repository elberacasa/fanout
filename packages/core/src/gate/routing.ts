import type { SeatInfo } from "../schema/common.ts";
import type { SeatPolicy } from "../schema/policy.ts";
import { stanceFor } from "../schema/policy.ts";
import type { SeatHeadroom } from "../projections/state.ts";

/*
 * Choosing which seat does a line, and being able to say why.
 *
 * A pure function over recorded facts, like the merge gate's judgement and for the same reason: a routing
 * decision that cannot be replayed is a decision nobody can argue with later. Every answer carries its reason in
 * words, because "moved to claude" is not something a person can act on and "codex reached its usage limit, and
 * you marked grok sparing" is.
 *
 * Three things decide it, in this order:
 *
 *   1. Can the seat work at all — installed, a version we verified, signed in, and not currently refusing?
 *   2. Did the owner say anything about spending it? A seat marked `off` is never chosen, however free it is.
 *   3. Of what is left, the plan's own choice first, then the owner's preference.
 *
 * Nothing here guesses at cost. We know a plan's name, not its price, and inventing an ordering from that would
 * be exactly the kind of confident arithmetic this project refuses elsewhere.
 */

export interface RoutingInput {
  /** The seat the plan asked for. */
  wanted: string;
  seats: readonly SeatInfo[];
  policy: SeatPolicy;
  headroom: Readonly<Record<string, SeatHeadroom>>;
  /** Now, for deciding whether a limit has since reset. */
  now: Date;
}

export type Routing =
  | { kind: "keep"; seat: string }
  | { kind: "move"; seat: string; from: string; reason: string }
  | { kind: "stuck"; from: string; reason: string };

/**
 * Why a seat cannot take work right now, or null when it can.
 *
 * `asFallback` is stricter, and the difference matters. When the plan named a seat, the person writing the plan
 * chose it and a CLI that simply cannot report its own sign-in — Grok and Kimi have no status command at all — is
 * not a reason to overrule them; we find out by running it. Moving work *onto* a seat is our decision rather than
 * theirs, and spending someone's subscription on a guess about whether it will even answer is not a decision to
 * make on their behalf.
 */
export function unavailable(
  seat: SeatInfo,
  policy: SeatPolicy,
  headroom: SeatHeadroom | undefined,
  now: Date,
  asFallback = false,
): string | null {
  const stance = stanceFor(seat, policy);
  if (stance.posture === "off") return `you set it to off (${stance.reason})`;
  if (seat.version === null) return "it is not installed";
  if (!seat.supported) return `version ${seat.version} is outside what its adapter was verified against`;
  if (seat.signedIn === "no") return "it is not signed in";
  if (asFallback && seat.signedIn === "unknown") {
    return "its CLI cannot tell us whether it is signed in, and this is not the seat you asked for";
  }

  const limited = headroom?.limited;
  if (limited != null) {
    /*
     * A limit that has passed its reset is not a limit. Believing an expired one forever would strand a seat
     * that came back an hour ago, and the reset time is the seat's own word rather than our guess.
     */
    if (limited.resetsAt === null || Date.parse(limited.resetsAt) > now.getTime()) {
      return `it said: ${limited.message}`;
    }
  }
  return null;
}

/**
 * Where this line should run.
 *
 * Keeps the plan's choice whenever it can, because the plan was written by someone who knew what the line needed
 * — a different model is a different result, not a free substitution, and moving work silently would hide that.
 */
export function routeLine(input: RoutingInput): Routing {
  const byId = new Map(input.seats.map((seat) => [seat.id, seat]));
  const asked = byId.get(input.wanted);

  const why = (seat: SeatInfo, asFallback: boolean): string | null =>
    unavailable(seat, input.policy, input.headroom[seat.id], input.now, asFallback);

  if (asked !== undefined && why(asked, false) === null) return { kind: "keep", seat: asked.id };

  const blocked =
    asked === undefined
      ? `${input.wanted} is not a seat on this machine`
      : `${input.wanted}: ${why(asked, false) ?? "unavailable"}`;

  /*
   * Ordered by what the owner said, then by name so the same crew always routes the same way. A stable answer
   * matters more than a clever one: a mission that picks a different seat on every run is a mission whose
   * results cannot be compared.
   */
  const rank = { preferred: 0, normal: 1, sparing: 2, off: 3 };
  const candidates = input.seats
    .filter((seat) => seat.id !== input.wanted && why(seat, true) === null)
    .sort((a, b) => {
      const order = rank[stanceFor(a, input.policy).posture] - rank[stanceFor(b, input.policy).posture];
      return order !== 0 ? order : a.id.localeCompare(b.id);
    });

  const chosen = candidates[0];
  if (chosen === undefined) {
    return { kind: "stuck", from: input.wanted, reason: `${blocked}, and no other seat can take it` };
  }

  const stance = stanceFor(chosen, input.policy);
  const note =
    stance.posture === "sparing"
      ? ` — ${chosen.id} is marked sparing${stance.note === undefined ? "" : `: ${stance.note}`}`
      : "";
  return { kind: "move", seat: chosen.id, from: input.wanted, reason: `${blocked}${note}` };
}
