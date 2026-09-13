import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { EMPTY_POLICY, SeatPolicy, type SeatPosture } from "fanout-core";

/*
 * Where the owner's seat preferences live, and — more importantly — what happens when that file is unreadable.
 *
 * The failure mode is the whole design here. "No preferences" and "I could not read your preferences" look
 * identical if you return an empty policy for both, and they are not the same at all: the first means use the
 * defaults, the second means a seat the owner switched off may be about to be spent. So a damaged file yields the
 * defaults *and* a problem, and any caller about to spend money on a seat must treat a problem as a refusal rather
 * than as a shrug.
 */

export const POLICY_FILE = "seats.json";

export interface PolicyRead {
  policy: SeatPolicy;
  /**
   * Null when the file was read or was simply absent. A string when something is wrong with it, in which case
   * `policy` holds the defaults and is **not** safe to act on: see the note above.
   */
  problem: string | null;
}

export function policyPath(home: string): string {
  return join(home, POLICY_FILE);
}

/** Reads the owner's seat preferences. An absent file is not a problem; an unreadable one is. */
export function readSeatPolicy(home: string): PolicyRead {
  const path = policyPath(home);

  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch (cause) {
    // Never having set a preference is the normal case, not an error.
    if ((cause as NodeJS.ErrnoException).code === "ENOENT") return { policy: EMPTY_POLICY, problem: null };
    return { policy: EMPTY_POLICY, problem: `${path} could not be read: ${describe(cause)}` };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { policy: EMPTY_POLICY, problem: `${path} is not valid JSON` };
  }

  const result = SeatPolicy.safeParse(parsed);
  if (!result.success) {
    const first = result.error.issues[0];
    const where = first === undefined ? "" : ` (${first.path.join(".")}: ${first.message})`;
    return { policy: EMPTY_POLICY, problem: `${path} is not a seat policy we understand${where}` };
  }

  return { policy: result.data, problem: null };
}

/**
 * Writes the preferences, replacing the file atomically.
 *
 * A half-written policy is the worst outcome available: it reads as damaged, which blocks work, and it does so at
 * the moment the owner was trying to change something. Writing beside the file and renaming means a reader sees
 * either the old policy or the new one, never a torn one.
 */
export function writeSeatPolicy(home: string, policy: SeatPolicy): void {
  const path = policyPath(home);
  mkdirSync(dirname(path), { recursive: true });

  const temporary = `${path}.${String(process.pid)}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(SeatPolicy.parse(policy), null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  renameSync(temporary, path);
}

/** Sets one seat's posture, leaving every other seat's preference exactly as it was. */
export function setPosture(
  policy: SeatPolicy,
  seatId: string,
  posture: SeatPosture,
  note?: string,
): SeatPolicy {
  return SeatPolicy.parse({
    version: 1,
    seats: {
      ...policy.seats,
      [seatId]: { posture, ...(note === undefined || note === "" ? {} : { note }) },
    },
  });
}

function describe(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}
