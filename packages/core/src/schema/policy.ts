import { z } from "zod";
import { SeatId, type SeatInfo } from "./common.ts";

/*
 * What the owner wants done with each seat, kept apart from what is true of it today.
 *
 * Posture is a preference and availability is a fact, and mixing them produces a interface that lies in both
 * directions: a seat you rely on looks disabled the morning its CLI fails to start, and a seat you asked us never
 * to touch looks ready the moment it signs in. They are resolved together only at the point of use, in `stanceFor`.
 *
 * This file holds only what the owner declared. It is never a cache of anything detected: a subscription tier
 * written down in June and read back in September is a stale answer presented as a current fact, and the whole
 * point of the `source` on a plan is that a reader can tell those apart.
 */

/**
 * How willingly Fanout should spend a seat.
 *
 * - `preferred` — reach for this first when several seats could do the line.
 * - `normal` — use it when the plan calls for it.
 * - `sparing` — only when nothing else fits, and say so before launching. For the subscription you pay least for.
 * - `off` — never, until the owner says otherwise.
 */
export const SeatPosture = z.enum(["preferred", "normal", "sparing", "off"]);
export type SeatPosture = z.infer<typeof SeatPosture>;

export const SeatPolicy = z.strictObject({
  version: z.literal(1),
  seats: z.record(
    SeatId,
    z.strictObject({
      posture: SeatPosture,
      /** The owner's own words about why, shown back to them so a past decision explains itself. */
      note: z.string().max(200).optional(),
    }),
  ),
});
export type SeatPolicy = z.infer<typeof SeatPolicy>;

export const EMPTY_POLICY: SeatPolicy = { version: 1, seats: {} };

/**
 * Claude is the only seat that is off until asked for.
 *
 * The lead already runs on this subscription, so a Claude worker spends the same window the session you are sitting
 * in is spending. That is a decision about someone's money, and it is theirs to make deliberately rather than to
 * discover afterwards (DECISIONS 0009).
 */
const OPT_IN_SEATS: ReadonlySet<string> = new Set(["claude"]);

export interface SeatStance {
  posture: SeatPosture;
  /** `declared` when the owner set it; `default` when nobody has, and `reason` says why that default. */
  source: "declared" | "default";
  reason: string;
  /** Willing *and* able: the posture allows it and the CLI is actually there and signed in. */
  usable: boolean;
  note?: string;
}

/**
 * What we should do with one seat right now, given what the owner declared and what detection found.
 *
 * Deliberately not clever. We know a plan's *name*, never its price, so nothing here infers that "pro" is cheaper
 * than "max" or that an unknown plan is a small one — the one fact only the owner has is which subscription they
 * would rather not spend, and the only honest way to learn it is to be told.
 */
export function stanceFor(seat: SeatInfo, policy: SeatPolicy): SeatStance {
  const declared = Object.hasOwn(policy.seats, seat.id) ? policy.seats[seat.id] : undefined;
  const posture: SeatPosture = declared?.posture ?? (OPT_IN_SEATS.has(seat.id) ? "off" : "normal");

  const reason =
    declared !== undefined
      ? "you set this"
      : OPT_IN_SEATS.has(seat.id)
        ? "opt-in: a worker here spends the same subscription your session is running on"
        : "nobody has said otherwise";

  return {
    posture,
    source: declared === undefined ? "default" : "declared",
    reason,
    usable: posture !== "off" && seat.supported && seat.signedIn === "yes",
    ...(declared?.note === undefined ? {} : { note: declared.note }),
  };
}

/** The seats a mission may draw on, most willing first, so a planner can take the head of the list. */
export function usableSeats(seats: readonly SeatInfo[], policy: SeatPolicy): SeatInfo[] {
  const rank: Record<SeatPosture, number> = { preferred: 0, normal: 1, sparing: 2, off: 3 };
  return seats
    .filter((seat) => stanceFor(seat, policy).usable)
    .sort((a, b) => rank[stanceFor(a, policy).posture] - rank[stanceFor(b, policy).posture]);
}
