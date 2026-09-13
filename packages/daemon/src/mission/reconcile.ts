import { project, type Ledger } from "fanout-core";

/*
 * Closing the books on runs whose supervisor is gone.
 *
 * Found by using the product the way a person will: a `/fanout` mission was launched from a Claude Code session,
 * the session ended while the agent was still working, and the run stayed recorded as `running` — eleven minutes,
 * then forever. Nothing was watching it, the process had died with its parent, and the ledger had no way to say
 * so. `fanout status` showed a mission in flight that had not existed for a quarter of an hour.
 *
 * The supervisor lives inside the session's MCP server, so this is not an edge case: it is what happens every
 * time somebody closes their terminal, and every time a print-mode session returns. The honest fix is not to
 * pretend those runs are alive, and not to guess in a projection either — a projection that invented a status
 * would be reading the ledger as a suggestion. It is to write down what is now known.
 *
 * A run is only ended here when we can prove nobody is watching: its supervisor's process id was recorded and
 * that process is gone. A run whose owner is still alive belongs to a session that is still going — a second
 * terminal, very possibly — and is left strictly alone.
 */

export interface ReconcileResult {
  /** Runs written off, by id, so a caller can say what it found rather than that it found something. */
  dropped: string[];
}

/** Whether a process exists. Signal 0 asks the kernel without disturbing it. */
function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (cause) {
    /*
     * `EPERM` means the process exists and belongs to somebody else — alive, and not ours to judge. Only
     * `ESRCH`, no such process, is proof of death. Treating a permission error as death would end another
     * user's runs on a shared machine.
     */
    return (cause as NodeJS.ErrnoException).code === "EPERM";
  }
}

/**
 * Ends every run this ledger still calls running whose supervisor has died.
 *
 * Called when a daemon starts, before anything reads the ledger for an answer — which is the first moment the
 * truth is knowable and the last moment it can be recorded without someone having already been misled.
 */
export function reconcile(ledger: Ledger, now = process.pid): ReconcileResult {
  const state = project(ledger.read());
  const dropped: string[] = [];

  for (const mission of Object.values(state.missions)) {
    for (const runId of mission.runOrder) {
      const run = mission.runs[runId];
      if (run?.status !== "running" && run?.status !== "queued") continue;

      /*
       * A queued run never started, so it has no owner to check: it was waiting for a slot in a mission that is
       * no longer being run by anybody, which is the same fate by a shorter road.
       */
      const owner = run.owner;
      if (owner !== null && (owner === now || alive(owner))) continue;

      ledger.append({
        type: "run.dropped",
        missionId: mission.missionId,
        runId,
        reason:
          owner === null
            ? "the session that started this run ended, and nothing recorded how it finished"
            : `the session supervising this run (process ${String(owner)}) is gone, so nothing was watching it`,
      });
      dropped.push(runId);
    }

    /*
     * A mission with nothing left running is over, whatever it was last called.
     *
     * Not only when this pass dropped something. A mission is also left open when the process that owned its
     * handle died between the last run finishing and the finish being written — every run settled, the mission
     * still reading `running`, and nothing that would ever say otherwise. Seen for real: a daemon restarted
     * after its runs had completed, and the mission showed `running · 1 waiting for review` indefinitely.
     */
    if (mission.status === "running" || mission.status === "planning") {
      const settled =
        mission.runOrder.length > 0 &&
        mission.runOrder.every((id) => {
          const status = mission.runs[id]?.status;
          return (status !== "running" && status !== "queued") || dropped.includes(id);
        });
      if (settled) {
        ledger.append({
          type: "mission.finished",
          missionId: mission.missionId,
          outcome: dropped.length > 0 ? "aborted" : "completed",
          summary:
            dropped.length > 0
              ? `${String(dropped.length)} run(s) ended when the session supervising them did`
              : "every run had finished; nothing recorded the mission as over",
        });
      }
    }
  }

  return { dropped };
}
