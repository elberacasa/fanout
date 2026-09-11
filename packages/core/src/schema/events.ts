import { z } from "zod";
import {
  DiffStat,
  GitSha,
  LineId,
  MissionId,
  MissionLimits,
  RunId,
  SafetyCheck,
  SeatId,
  SeatInfo,
  SeatRef,
} from "./common.ts";
import { PlanGraph } from "./plan.ts";

/*
 * Every fact the daemon records is one of these events. Rules for changing this file:
 * - Adding a new event type is additive: old ledgers stay valid.
 * - Changing the shape of an existing type needs a new EVENT_VERSION and an upgrade path for stored events.
 * - Events carry no secrets and no raw logs: summaries, paths and numbers only.
 */

export const EVENT_VERSION = 1 as const;

const mission = { missionId: MissionId };
const run = { missionId: MissionId, runId: RunId };

const PlanAuthor = z.enum(["lead", "user"]);
const Phase = z.enum(["reading", "coding", "testing", "reporting"]);
const RepoPaths = z.array(z.string().min(1).max(1000)).max(1000);

export const SeatDetected = z.strictObject({
  type: z.literal("seat.detected"),
  seat: SeatInfo,
});

export const MissionCreated = z.strictObject({
  type: z.literal("mission.created"),
  ...mission,
  goal: z.string().trim().min(1).max(4000),
  repo: z.strictObject({ root: z.string().min(1).max(1000), baseCommit: GitSha }),
  limits: MissionLimits,
});

export const PlanProposed = z.strictObject({
  type: z.literal("plan.proposed"),
  ...mission,
  plan: PlanGraph,
  by: PlanAuthor,
  note: z.string().max(2000).optional(),
});

export const PlanRevised = z.strictObject({
  type: z.literal("plan.revised"),
  ...mission,
  plan: PlanGraph,
  by: PlanAuthor,
  note: z.string().max(2000).optional(),
});

export const SafetyReported = z
  .strictObject({
    type: z.literal("safety.report"),
    ...mission,
    ok: z.boolean(),
    checks: z.array(SafetyCheck).max(200),
  })
  .refine((report) => report.ok === report.checks.every((check) => check.ok || check.severity === "warn"), {
    message: "ok must be true exactly when no blocking check failed",
    path: ["ok"],
  });

export const RunQueued = z.strictObject({
  type: z.literal("run.queued"),
  ...run,
  lineId: LineId,
  seat: SeatRef,
  attempt: z.int().min(1).max(3),
});

export const RunStarted = z.strictObject({
  type: z.literal("run.started"),
  ...run,
  workdir: z.string().min(1).max(1000),
  argv: z.array(z.string().max(200_000)).min(1).max(200),
});

export const RunProgress = z.strictObject({
  type: z.literal("run.progress"),
  ...run,
  phase: Phase,
  detail: z.string().max(500).optional(),
});

export const RunTool = z.strictObject({
  type: z.literal("run.tool"),
  ...run,
  tool: z.string().min(1).max(100),
  summary: z.string().max(500).optional(),
  files: RepoPaths.default([]),
});

export const RunUsage = z.strictObject({
  type: z.literal("run.usage"),
  ...run,
  seat: SeatId,
  amount: z.number().nonnegative(),
  unit: z.enum(["messages", "tokens", "minutes"]),
  estimated: z.boolean(),
});

export const RunFinished = z.strictObject({
  type: z.literal("run.finished"),
  ...run,
  status: z.enum(["done", "failed", "killed", "timeout"]),
  exitCode: z.int().nullable(),
  reportPath: z.string().min(1).max(1000).optional(),
  diffStat: DiffStat.optional(),
});

export const ReviewDone = z.strictObject({
  type: z.literal("review.done"),
  ...run,
  verdict: z.enum(["accept", "rework", "reject"]),
  notes: z.string().max(20_000),
  by: SeatRef,
});

export const ChecksDone = z.strictObject({
  type: z.literal("checks.done"),
  ...run,
  ok: z.boolean(),
  summary: z.string().max(4000),
});

/** Proof of a fix: the new tests that fail on the old code (and pass on the new). */
export const ProofDone = z
  .strictObject({
    type: z.literal("proof.done"),
    ...run,
    ok: z.boolean(),
    failedOnOld: z.array(z.string().min(1).max(500)).max(500),
  })
  .refine((proof) => !proof.ok || proof.failedOnOld.length > 0, {
    message: "a passing proof names at least one test that failed on the old code",
    path: ["failedOnOld"],
  });

export const MergeApplied = z.strictObject({
  type: z.literal("merge.applied"),
  ...run,
  files: RepoPaths.min(1),
});

export const MergeConflict = z.strictObject({
  type: z.literal("merge.conflict"),
  ...run,
  files: RepoPaths.min(1),
});

export const RunDropped = z.strictObject({
  type: z.literal("run.dropped"),
  ...run,
  reason: z.string().trim().min(1).max(2000),
});

export const RouteChanged = z.strictObject({
  type: z.literal("route.changed"),
  ...mission,
  lineId: LineId,
  from: SeatRef,
  to: SeatRef,
  reason: z.string().trim().min(1).max(500),
});

export const PolicyBreach = z.strictObject({
  type: z.literal("policy.breach"),
  ...run,
  limit: z.string().min(1).max(100),
  action: z.enum(["killed", "paused", "asked"]),
});

export const MissionFinished = z.strictObject({
  type: z.literal("mission.finished"),
  ...mission,
  outcome: z.enum(["completed", "aborted"]),
  summary: z.string().max(8000),
});

export const FanoutEvent = z.discriminatedUnion("type", [
  SeatDetected,
  MissionCreated,
  PlanProposed,
  PlanRevised,
  SafetyReported,
  RunQueued,
  RunStarted,
  RunProgress,
  RunTool,
  RunUsage,
  RunFinished,
  ReviewDone,
  ChecksDone,
  ProofDone,
  MergeApplied,
  MergeConflict,
  RunDropped,
  RouteChanged,
  PolicyBreach,
  MissionFinished,
]);

/** An event as validated (defaults applied). */
export type FanoutEvent = z.infer<typeof FanoutEvent>;
/** An event as written by a producer (defaults may be omitted). */
export type FanoutEventInput = z.input<typeof FanoutEvent>;
export type EventType = FanoutEvent["type"];
export type EventOf<T extends EventType> = Extract<FanoutEvent, { type: T }>;

/** What the ledger adds when it records an event. */
export const EventStamp = z.strictObject({
  v: z.literal(EVENT_VERSION),
  id: z.uuid(),
  seq: z.int().positive(),
  ts: z.iso.datetime(),
});
export type EventStamp = z.infer<typeof EventStamp>;

/** An event as stored in and read from the ledger. */
export type StoredEvent = FanoutEvent & EventStamp;
