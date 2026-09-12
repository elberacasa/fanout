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
  WorkRevision,
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
    /** Which plan revision this report describes. A newer plan makes it stale, never current. */
    planRevision: z.int().positive(),
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

/*
 * The merge gate, in events. Every one of them names the `revision` it judged, because each is a statement about a
 * specific diff and not about a worktree that may since have moved. A merge applies a revision only when review,
 * checks, proof and approval all named that same one; anything else is a claim about work nobody looked at.
 */

export const ReviewDone = z.strictObject({
  type: z.literal("review.done"),
  ...run,
  revision: WorkRevision,
  verdict: z.enum(["accept", "rework", "reject"]),
  notes: z.string().max(20_000),
  by: SeatRef,
});

export const ChecksDone = z.strictObject({
  type: z.literal("checks.done"),
  ...run,
  revision: WorkRevision,
  ok: z.boolean(),
  summary: z.string().max(4000),
  /** What actually ran, so "checks pass" can be read as a claim about specific commands. */
  commands: z.array(z.string().min(1).max(500)).max(50),
});

/** Proof of a fix: the new tests that fail on the old code (and pass on the new). */
export const ProofDone = z
  .strictObject({
    type: z.literal("proof.done"),
    ...run,
    revision: WorkRevision,
    ok: z.boolean(),
    failedOnOld: z.array(z.string().min(1).max(500)).max(500),
  })
  .refine((proof) => !proof.ok || proof.failedOnOld.length > 0, {
    message: "a passing proof names at least one test that failed on the old code",
    path: ["failedOnOld"],
  });

/**
 * Someone said yes. Recorded separately from the merge itself so a replay can answer "who authorised this?" —
 * a question a diff in the history cannot answer on its own.
 */
export const MergeApproved = z.strictObject({
  type: z.literal("merge.approved"),
  ...run,
  revision: WorkRevision,
  /**
   * A person, or a policy the person wrote down in advance. A policy must name itself: "it was pre-approved" is
   * not an answer anyone can audit, and "which rule, written when" is.
   */
  by: z.discriminatedUnion("kind", [
    z.strictObject({ kind: z.literal("user") }),
    z.strictObject({ kind: z.literal("policy"), name: z.string().trim().min(1).max(200) }),
  ]),
  note: z.string().max(2000).optional(),
});

export const MergeApplied = z.strictObject({
  type: z.literal("merge.applied"),
  ...run,
  revision: WorkRevision,
  files: RepoPaths.min(1),
  /** Where the work landed, so a dependent line can start from it rather than from a guess. */
  commit: GitSha,
});

export const MergeConflict = z.strictObject({
  type: z.literal("merge.conflict"),
  ...run,
  revision: WorkRevision,
  files: RepoPaths.min(1),
});

export const RunDropped = z.strictObject({
  type: z.literal("run.dropped"),
  ...run,
  reason: z.string().trim().min(1).max(2000),
});

/**
 * A second vendor read the lead's own uncommitted work.
 *
 * Not a mission and not a run: no agent worked in a worktree, and forcing this into the mission machinery would
 * put a fake mission in front of the user for every review. It carries no `missionId` for the same reason
 * `seat.detected` does not — it is a fact about this machine at a moment, not about a mission.
 *
 * This is the event that answers the product's only real question: was anything other than the author's own
 * judgement applied to this code before it was called done?
 */
export const BuddyReviewed = z.strictObject({
  type: z.literal("buddy.reviewed"),
  /** Which working tree, so a review of one repository is never read as covering another. */
  repoRoot: z.string().min(1).max(1000),
  revision: WorkRevision,
  by: SeatRef,
  /** What it said, verbatim. A second opinion summarised by the author is not a second opinion. */
  findings: z.string().max(100_000),
  /** False when the reviewer could not be run at all, so "no findings" never stands in for "never asked". */
  ran: z.boolean(),
  files: RepoPaths.max(1000),
});

/**
 * The lead wrote down what it believes, and a cold reader checked each belief against the code.
 *
 * This is the sharpest thing a second vendor can do, and the cheapest. The lead carries the whole session — the
 * plan, the reasoning, the justification — and that context is precisely what makes its own mistakes invisible to
 * it: it knows why the code is right, so the code looks right. A reader arriving with only the diff is not
 * smarter, it is differently placed, which is why even a small model reading cold can refute a large one reading
 * warm. Asking it to review everything spends tokens on that asymmetry. Asking it to falsify three specific
 * claims spends almost none.
 *
 * Recording the claims, not only the verdicts, is the point. A replay shows what the lead asserted as well as
 * what turned out to be true, and an author who must write down falsifiable claims notices the weak ones while
 * writing them.
 */
export const ClaimsChecked = z.strictObject({
  type: z.literal("claims.checked"),
  repoRoot: z.string().min(1).max(1000),
  revision: WorkRevision,
  by: SeatRef,
  claims: z
    .array(
      z.strictObject({
        /** What the lead asserted, in its own words. */
        claim: z.string().trim().min(1).max(500),
        /**
         * `unclear` is the default and the only safe absence. A verdict we could not read is not a pass, and a
         * claim the reader ignored has not been checked — treating either as confirmed would make this theatre.
         */
        verdict: z.enum(["confirmed", "refuted", "unclear"]),
        /** Why, in the reader's own words. Required for a refusal; a bare "no" helps nobody. */
        evidence: z.string().max(4000),
      }),
    )
    .min(1)
    .max(20),
  /** False when the reader could not be run at all, so "nothing refuted" never stands in for "never asked". */
  ran: z.boolean(),
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
  BuddyReviewed,
  ClaimsChecked,
  MergeApproved,
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
