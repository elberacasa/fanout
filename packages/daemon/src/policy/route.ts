import { routeLine, type Routing, type SeatHeadroom, type SeatInfo } from "fanout-core";
import { readSeatPolicy } from "./seats.ts";

/*
 * Where a line runs, given what is actually on this machine.
 *
 * `routeLine` in core decides it from facts; this decides which facts we are entitled to use. The two are separate
 * because the interesting failures here are not about choosing badly, they are about choosing at all on top of
 * something we did not really read — and that question has nothing to do with the ordering rules in core.
 *
 * Every refusal below resolves the same way: keep the seat the plan named. That is the choice that can only fail
 * loudly. A line kept on a seat that has run out stops with the seat's own message on screen; a line moved onto a
 * seat the owner switched off spends their subscription and tells them afterwards.
 */

export interface RouteContext {
  /** The owner's fanout home, where seat preferences live. */
  home: string;
  /** What detection found. Empty means it has not answered yet. */
  crew: readonly SeatInfo[];
  headroom: Readonly<Record<string, SeatHeadroom>>;
  now: Date;
}

/**
 * Decides where a line runs, or declines to decide.
 *
 * The policy read is the reason this function exists. `readSeatPolicy` hands back defaults *and* a problem when
 * the file is damaged, and says in its own documentation that the defaults are not safe to act on — a caller that
 * destructures `policy` and drops `problem` gets code that looks right, passes, and one day moves work onto a
 * seat the owner had turned off. So a problem here means we route nothing.
 */
export function chooseSeat(wanted: string, context: RouteContext): Routing {
  // Detection has not answered. The safety report has already told the user which seats it could not see.
  if (context.crew.length === 0) return { kind: "keep", seat: wanted };

  const { policy, problem } = readSeatPolicy(context.home);
  if (problem !== null) return { kind: "keep", seat: wanted };

  return routeLine({ wanted, seats: context.crew, policy, headroom: context.headroom, now: context.now });
}
