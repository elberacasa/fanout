import { mergeReadiness, type MissionView, type PlanLine, type RunView } from "@fanout/core";

/*
 * What is still owed, for the Stop hook.
 *
 * Everything else in Fanout is a tool the lead chooses to call, and that is the weakness: the failure mode is not
 * "the gate said no", it is "nobody asked the gate", or a lead that believes its own work is finished. A hook runs
 * whether or not anyone remembered it, which makes "done" a claim the session can check rather than one it asserts.
 *
 * It reports; it does not block. A hook that refused to let a session end would be a hostage-taker the first time
 * someone legitimately wanted to stop — and a person who wants to walk away from unfinished work is allowed to.
 * The point is that they do it knowingly.
 */

export interface Owed {
  missionId: string;
  runId: string;
  /** One line, written for someone about to close their laptop. */
  what: string;
}

/**
 * Every run that is waiting on the lead: finished agents nobody has reviewed, checks nobody has run, fixes with
 * no proof, work reviewed at a revision that has since moved.
 *
 * Runs still working are deliberately not here. They are not owed by anyone; they are simply not done, and the
 * mission view says so already.
 */
export function whatIsOwed(missions: readonly MissionView[]): Owed[] {
  const owed: Owed[] = [];

  for (const mission of missions) {
    const lines = new Map<string, PlanLine>((mission.plan?.lines ?? []).map((line) => [line.id, line]));

    for (const runId of mission.runOrder) {
      const run = mission.runs[runId];
      if (run === undefined || !waitingOnTheLead(run)) continue;

      const line = lines.get(run.lineId);
      if (line === undefined) {
        owed.push({ missionId: mission.missionId, runId, what: "finished, but its plan line is missing" });
        continue;
      }

      /*
       * The run's own recorded revision is the best we can do from the ledger alone: a hook must not go and read
       * the worktree, because it runs on every turn and must stay fast. Asking readiness about the revision the
       * review saw answers "is anything missing", which is the hook's question — "has the work moved since" is
       * the merge tool's, and it recollects the diff to find out.
       */
      const judged = run.review?.revision ?? run.checks?.revision ?? run.approval?.revision ?? "";
      const { blockers } = mergeReadiness(run, line, judged);
      const first = blockers[0];
      if (first !== undefined) owed.push({ missionId: mission.missionId, runId, what: first.message });
    }
  }

  return owed;
}

/** A run the agent has finished with, that has not yet been merged, dropped or run into a conflict. */
function waitingOnTheLead(run: RunView): boolean {
  return run.status === "done";
}

/** The hook's whole output. Empty string when nothing is owed, so a quiet session stays quiet. */
export function unfinishedReport(owed: readonly Owed[]): string {
  if (owed.length === 0) return "";

  const lines = owed.map((item) => `  ${item.missionId} · ${item.runId}: ${item.what}`);
  const count = `${String(owed.length)} run${owed.length === 1 ? "" : "s"}`;
  return (
    `Fanout: ${count} still waiting on you before anything can merge.\n${lines.join("\n")}\n` +
    `Nothing has been merged. Review them, or drop them on purpose.\n`
  );
}
