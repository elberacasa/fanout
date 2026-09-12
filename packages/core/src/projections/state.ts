import type { DiffStat, MissionLimits, SafetyCheck, SeatInfo, SeatRef } from "../schema/common.ts";
import type { EventOf, StoredEvent } from "../schema/events.ts";
import type { PlanGraph } from "../schema/plan.ts";

/*
 * Projections are pure folds over the ledger: state(n + 1) = applyEvent(state(n), event n + 1).
 * They never mutate their input, so any intermediate state can be kept, compared or sent to a client.
 * An event that doesn't fit (an unknown mission or run, a duplicate, a sequence out of order) is recorded as an
 * anomaly instead of being silently dropped or crashing the view.
 */

export type RunPhase = EventOf<"run.progress">["phase"];
export type UsageUnit = EventOf<"run.usage">["unit"];
export type RunStatus =
  "queued" | "running" | "done" | "failed" | "killed" | "timeout" | "merged" | "conflict" | "dropped";

export interface UsageMeter {
  amount: number;
  /** True when any part of the amount is an estimate. */
  estimated: boolean;
}
export type UsageMeters = Partial<Record<UsageUnit, UsageMeter>>;

export interface RunView {
  runId: string;
  lineId: string;
  seat: SeatRef;
  attempt: number;
  status: RunStatus;
  phase: RunPhase | null;
  lastTool: { tool: string; summary: string | null } | null;
  /** Files the run touched, sorted, without duplicates. */
  files: string[];
  diffStat: DiffStat | null;
  exitCode: number | null;
  usage: UsageMeters;
  /*
   * Each step of the gate remembers the revision it judged. A merge that applies a different one is applying work
   * nobody in this list actually looked at, which is the single failure the gate exists to prevent.
   */
  review: { verdict: EventOf<"review.done">["verdict"]; notes: string; by: SeatRef; revision: string } | null;
  checks: { ok: boolean; summary: string; commands: string[]; revision: string } | null;
  proof: { ok: boolean; failedOnOld: string[]; revision: string } | null;
  approval: { by: EventOf<"merge.approved">["by"]; revision: string; note: string | null } | null;
  /** What was merged, and where it landed, so a dependent line can start from a fact. */
  merged: { revision: string; commit: string } | null;
  mergedFiles: string[];
  conflictFiles: string[];
  dropReason: string | null;
  breaches: { limit: string; action: EventOf<"policy.breach">["action"] }[];
  queuedSeq: number;
  startedSeq: number | null;
  updatedSeq: number;
  /* The three moments a watcher asks about. Stamped by the ledger, never computed here: see `elapsedMs`. */
  queuedAt: string;
  startedAt: string | null;
  /** When the agent's own work stopped. Review, merge and drop happen after this and do not move it. */
  endedAt: string | null;
  /** The last time this run produced any event at all: its most recent sign of life. */
  updatedAt: string;
}

/**
 * How long a run has been working, in milliseconds, or `null` if it has not started — never `0`, because
 * "not started" and "started a moment ago" are different facts and a watcher deserves to know which.
 *
 * A finished run is measured between its own two stamps, so its duration never changes after the fact. A running
 * one is measured against `now`, so a slow run is visibly slow rather than indistinguishable from a stuck one.
 * That is why the projection stores stamps and not a duration: a stored elapsed time is stale the moment it is read.
 *
 * A clock that has moved backwards (an NTP correction, a laptop waking) clamps to 0 rather than showing a negative
 * age, since a run cannot have started in the future.
 */
export function elapsedMs(run: RunView, now: Date): number | null {
  if (run.startedAt === null) return null;
  const from = Date.parse(run.startedAt);
  const to = run.endedAt === null ? now.getTime() : Date.parse(run.endedAt);
  return Math.max(0, to - from);
}

/**
 * How long a still-running run has said nothing, in milliseconds, or `null` once it has ended — a finished run is
 * not silent, it is simply over.
 *
 * Elapsed time alone cannot tell a thinking agent from a dead one: both counters climb. The gap since the last
 * event can, which makes this the number worth putting in front of someone deciding whether to wait or to kill.
 *
 * Only a run that is actually working can be silent. A queued run has not been launched and a finished one is
 * simply over; reporting either as "quiet for 30 minutes" would raise an alarm about the scheduler doing its job.
 */
export function silentMs(run: RunView, now: Date): number | null {
  if (run.startedAt === null || run.endedAt !== null) return null;
  return Math.max(0, now.getTime() - Date.parse(run.updatedAt));
}

export interface RouteChange {
  lineId: string;
  from: SeatRef;
  to: SeatRef;
  reason: string;
  seq: number;
}

export interface MissionView {
  missionId: string;
  goal: string;
  repo: { root: string; baseCommit: string };
  limits: MissionLimits;
  status: "planning" | "running" | "finished" | "aborted";
  plan: PlanGraph | null;
  /** 0 before any plan, then 1, 2, … for each proposal or revision. */
  planRevision: number;
  /** The safety report for the current plan revision; a new plan clears it, a stale one is refused. */
  safety: { ok: boolean; checks: SafetyCheck[]; planRevision: number } | null;
  runs: Record<string, RunView>;
  runOrder: string[];
  routes: RouteChange[];
  summary: string | null;
  createdSeq: number;
  updatedSeq: number;
}

export interface Anomaly {
  seq: number;
  type: string;
  message: string;
}

export interface BuddyReview {
  revision: string;
  by: SeatRef;
  findings: string;
  ran: boolean;
  files: string[];
  at: string;
}

export interface ClaimCheck {
  revision: string;
  by: SeatRef;
  claims: EventOf<"claims.checked">["claims"];
  ran: boolean;
  /** These verdicts were written, not read: the offline demo. Every surface that shows them must say so. */
  simulated: boolean;
  at: string;
}

export interface ProjectionState {
  lastSeq: number;
  crew: Record<string, SeatInfo>;
  /** The most recent second-vendor review of the lead's own work, per repository root. */
  buddy: Record<string, BuddyReview>;
  /** The most recent claim check of the lead's own work, per repository root. */
  claims: Record<string, ClaimCheck>;
  usage: Record<string, UsageMeters>;
  missions: Record<string, MissionView>;
  anomalies: Anomaly[];
}

export function initialState(): ProjectionState {
  return { lastSeq: 0, crew: {}, buddy: {}, claims: {}, usage: {}, missions: {}, anomalies: [] };
}

/** Folds events into a state, starting from an empty one or from a state already projected. */
export function project(
  events: Iterable<StoredEvent>,
  from: ProjectionState = initialState(),
): ProjectionState {
  let state = from;
  for (const event of events) state = applyEvent(state, event);
  return state;
}

export function applyEvent(state: ProjectionState, event: StoredEvent): ProjectionState {
  if (event.seq <= state.lastSeq) {
    return withAnomaly(state, event, `sequence ${event.seq} arrived after ${state.lastSeq}; ignored`);
  }
  return { ...reduce(state, event), lastSeq: event.seq };
}

function reduce(state: ProjectionState, event: StoredEvent): ProjectionState {
  switch (event.type) {
    case "seat.detected":
      return { ...state, crew: { ...state.crew, [event.seat.id]: event.seat } };

    /*
     * Kept per repository and per revision rather than as a list. The only question anyone asks of it is "has
     * *this* work been read by someone other than its author", and a history of reviews of older work answers a
     * question nobody is asking while making the answer to this one harder to find.
     */
    /*
     * Kept per repository and per revision, like the buddy review, and for the same reason: the only question
     * anyone asks is what was checked about *this* work, and a history of verdicts on older work buries it.
     */
    case "claims.checked":
      return {
        ...state,
        claims: {
          ...state.claims,
          [event.repoRoot]: {
            revision: event.revision,
            by: event.by,
            claims: event.claims,
            ran: event.ran,
            simulated: event.simulated,
            at: event.ts,
          },
        },
      };

    case "buddy.reviewed":
      return {
        ...state,
        buddy: {
          ...state.buddy,
          [event.repoRoot]: {
            revision: event.revision,
            by: event.by,
            findings: event.findings,
            ran: event.ran,
            files: event.files,
            at: event.ts,
          },
        },
      };

    case "mission.created": {
      if (Object.hasOwn(state.missions, event.missionId)) {
        return withAnomaly(state, event, `mission "${event.missionId}" already exists`);
      }
      const mission: MissionView = {
        missionId: event.missionId,
        goal: event.goal,
        repo: event.repo,
        limits: event.limits,
        status: "planning",
        plan: null,
        planRevision: 0,
        safety: null,
        runs: {},
        runOrder: [],
        routes: [],
        summary: null,
        createdSeq: event.seq,
        updatedSeq: event.seq,
      };
      return { ...state, missions: { ...state.missions, [event.missionId]: mission } };
    }

    case "plan.proposed":
    case "plan.revised":
      return updateMission(state, event, (mission) => ({
        ...mission,
        plan: event.plan,
        planRevision: mission.planRevision + 1,
        safety: null,
      }));

    case "safety.report":
      return updateMission(state, event, (mission) =>
        event.planRevision === mission.planRevision
          ? { ...mission, safety: { ok: event.ok, checks: event.checks, planRevision: event.planRevision } }
          : `safety report is for plan revision ${event.planRevision}, ` +
            `but the mission is at revision ${mission.planRevision}`,
      );

    case "route.changed":
      return updateMission(state, event, (mission) => ({
        ...mission,
        routes: [
          ...mission.routes,
          { lineId: event.lineId, from: event.from, to: event.to, reason: event.reason, seq: event.seq },
        ],
      }));

    case "mission.finished":
      return updateMission(state, event, (mission) => ({
        ...mission,
        status: event.outcome === "completed" ? "finished" : "aborted",
        summary: event.summary,
      }));

    case "run.queued":
      return updateMission(state, event, (mission) => {
        if (Object.hasOwn(mission.runs, event.runId)) return `run "${event.runId}" already exists`;
        const run: RunView = {
          runId: event.runId,
          lineId: event.lineId,
          seat: event.seat,
          attempt: event.attempt,
          status: "queued",
          phase: null,
          lastTool: null,
          files: [],
          diffStat: null,
          exitCode: null,
          usage: {},
          review: null,
          checks: null,
          proof: null,
          approval: null,
          merged: null,
          mergedFiles: [],
          conflictFiles: [],
          dropReason: null,
          breaches: [],
          queuedSeq: event.seq,
          startedSeq: null,
          updatedSeq: event.seq,
          queuedAt: event.ts,
          startedAt: null,
          endedAt: null,
          updatedAt: event.ts,
        };
        return {
          ...mission,
          status: mission.status === "planning" ? "running" : mission.status,
          runs: { ...mission.runs, [event.runId]: run },
          runOrder: [...mission.runOrder, event.runId],
        };
      });

    case "run.started":
      return updateRun(state, event, (run) => ({
        ...run,
        status: "running",
        startedSeq: event.seq,
        startedAt: event.ts,
      }));

    case "run.progress":
      return updateRun(state, event, (run) => ({ ...run, phase: event.phase }));

    case "run.tool":
      return updateRun(state, event, (run) => ({
        ...run,
        lastTool: { tool: event.tool, summary: event.summary ?? null },
        files: sortedUnion(run.files, event.files),
      }));

    case "run.usage": {
      const next = updateRun(state, event, (run) =>
        run.seat.id === event.seat
          ? { ...run, usage: addUsage(run.usage, event) }
          : `usage is charged to seat "${event.seat}" but run "${event.runId}" is on "${run.seat.id}"`,
      );
      if (next.anomalies.length > state.anomalies.length) return next;
      return {
        ...next,
        usage: { ...next.usage, [event.seat]: addUsage(next.usage[event.seat] ?? {}, event) },
      };
    }

    case "run.finished":
      return updateRun(state, event, (run) => ({
        ...run,
        status: event.status,
        exitCode: event.exitCode,
        diffStat: event.diffStat ?? run.diffStat,
        endedAt: event.ts,
      }));

    case "review.done":
      return updateRun(state, event, (run) => ({
        ...run,
        review: { verdict: event.verdict, notes: event.notes, by: event.by, revision: event.revision },
      }));

    case "checks.done":
      return updateRun(state, event, (run) => ({
        ...run,
        checks: {
          ok: event.ok,
          summary: event.summary,
          commands: event.commands,
          revision: event.revision,
        },
      }));

    case "proof.done":
      return updateRun(state, event, (run) => ({
        ...run,
        proof: { ok: event.ok, failedOnOld: event.failedOnOld, revision: event.revision },
      }));

    case "merge.approved":
      return updateRun(state, event, (run) => ({
        ...run,
        approval: { by: event.by, revision: event.revision, note: event.note ?? null },
      }));

    case "merge.applied":
      return updateRun(state, event, (run) => ({
        ...run,
        status: "merged",
        mergedFiles: event.files,
        merged: { revision: event.revision, commit: event.commit },
      }));

    case "merge.conflict":
      return updateRun(state, event, (run) => ({ ...run, status: "conflict", conflictFiles: event.files }));

    case "run.dropped":
      return updateRun(state, event, (run) => ({ ...run, status: "dropped", dropReason: event.reason }));

    case "policy.breach":
      return updateRun(state, event, (run) => ({
        ...run,
        breaches: [...run.breaches, { limit: event.limit, action: event.action }],
      }));
  }
}

/** Applies `change` to the event's mission; a returned string is recorded as an anomaly instead. */
function updateMission(
  state: ProjectionState,
  event: StoredEvent & { missionId: string },
  change: (mission: MissionView) => MissionView | string,
): ProjectionState {
  const mission = Object.hasOwn(state.missions, event.missionId)
    ? state.missions[event.missionId]
    : undefined;
  if (mission === undefined) return withAnomaly(state, event, `unknown mission "${event.missionId}"`);
  const next = change(mission);
  if (typeof next === "string") return withAnomaly(state, event, next);
  return { ...state, missions: { ...state.missions, [event.missionId]: { ...next, updatedSeq: event.seq } } };
}

/** A run that merged or was dropped is finished for good; later run events are anomalies, not a second life. */
const TERMINAL: ReadonlySet<RunStatus> = new Set<RunStatus>(["merged", "dropped"]);

function updateRun(
  state: ProjectionState,
  event: StoredEvent & { missionId: string; runId: string },
  change: (run: RunView) => RunView | string,
): ProjectionState {
  return updateMission(state, event, (mission) => {
    const run = Object.hasOwn(mission.runs, event.runId) ? mission.runs[event.runId] : undefined;
    if (run === undefined) return `unknown run "${event.runId}" in mission "${event.missionId}"`;
    if (TERMINAL.has(run.status)) {
      return `run "${event.runId}" is already ${run.status}; "${event.type}" cannot change it`;
    }
    const next = change(run);
    if (typeof next === "string") return next;
    return {
      ...mission,
      runs: { ...mission.runs, [event.runId]: { ...next, updatedSeq: event.seq, updatedAt: event.ts } },
    };
  });
}

function withAnomaly(state: ProjectionState, event: StoredEvent, message: string): ProjectionState {
  return { ...state, anomalies: [...state.anomalies, { seq: event.seq, type: event.type, message }] };
}

function addUsage(meters: UsageMeters, event: EventOf<"run.usage">): UsageMeters {
  const previous = meters[event.unit];
  return {
    ...meters,
    [event.unit]: {
      amount: (previous?.amount ?? 0) + event.amount,
      estimated: (previous?.estimated ?? false) || event.estimated,
    },
  };
}

function sortedUnion(left: string[], right: string[]): string[] {
  return [...new Set([...left, ...right])].sort();
}
