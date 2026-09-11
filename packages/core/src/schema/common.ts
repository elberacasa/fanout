import { z } from "zod";

/** Identifiers people read: mission, line, run and seat ids ("csv-export", "api-builder-1", "codex"). */
export const Slug = z
  .string()
  .regex(/^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/, "use lowercase letters, digits and inner dashes (max 64)");

export const MissionId = Slug;
export const LineId = Slug;
export const RunId = Slug;
export const SeatId = Slug;

/** A full commit id: 40 hex characters (SHA-1 repositories) or 64 (SHA-256 repositories). */
export const GitSha = z.string().regex(/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/, "a full commit sha");

/** Which seat runs a line, and optionally with which model and effort. */
export const SeatRef = z.strictObject({
  id: SeatId,
  model: z.string().min(1).max(100).optional(),
  effort: z.string().min(1).max(40).optional(),
});
export type SeatRef = z.infer<typeof SeatRef>;

/** What the detector knows about an installed agent CLI. Unknown facts say "unknown" or null, never a guess. */
export const SeatInfo = z.strictObject({
  id: SeatId,
  displayName: z.string().min(1).max(80),
  binary: z.string().min(1).max(200),
  version: z.string().min(1).max(100).nullable(),
  supported: z.boolean(),
  signedIn: z.enum(["yes", "no", "unknown"]),
  models: z.array(z.string().min(1).max(100)).max(100),
  efforts: z.array(z.string().min(1).max(40)).max(20),
  billing: z.enum(["subscription", "credit", "api", "unknown"]),
});
export type SeatInfo = z.infer<typeof SeatInfo>;

export const DiffStat = z.strictObject({
  files: z.int().nonnegative(),
  insertions: z.int().nonnegative(),
  deletions: z.int().nonnegative(),
});
export type DiffStat = z.infer<typeof DiffStat>;

export const MissionLimits = z.strictObject({
  maxParallel: z.int().min(1).max(32),
  timeoutMinutes: z
    .int()
    .min(1)
    .max(24 * 60),
});
export type MissionLimits = z.infer<typeof MissionLimits>;

/** One line of the safety report. A failed "block" check stops the launch; a failed "warn" check is shown. */
export const SafetyCheck = z.strictObject({
  id: z.string().min(1).max(64),
  ok: z.boolean(),
  severity: z.enum(["block", "warn"]),
  message: z.string().min(1).max(2000),
  lineIds: z.array(LineId).max(32).optional(),
});
export type SafetyCheck = z.infer<typeof SafetyCheck>;
