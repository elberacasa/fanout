import { elapsedMs, silentMs, type MissionView, type RunPhase, type RunView } from "../projections/state.ts";

/*
 * How a crew reads to a human, in one place.
 *
 * The lead reads this in a chat, the owner reads it in a terminal, and later a browser will draw the same facts.
 * They share this module so the three can never disagree: a mission that looks stalled in one surface and healthy
 * in another is worse than either answer alone.
 *
 * The rule these functions follow is the project's sixth non-negotiable. Every number here is measured, never
 * guessed; what is unknown prints as "—" rather than as a zero that reads like a fact; and nothing implies we know
 * how much work is left, because we do not.
 */

/** Below this, an agent that has not spoken is simply thinking, and saying "quiet" would cry wolf. */
const QUIET_AFTER_MS = 60_000;

const PHASES: readonly RunPhase[] = ["reading", "coding", "testing", "reporting"];

const DASH = "—";

/**
 * A duration a person can read at a glance: `9s`, `6m 38s`, `2h 05m`.
 *
 * Always rounds down. A run that has been going 119 seconds is in its first minute and fifty-ninth second, not its
 * second minute, and rounding up would make every run look slightly further along than it is.
 */
export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const seconds = total % 60;
  const minutes = Math.floor(total / 60) % 60;
  const hours = Math.floor(total / 3600);

  if (hours > 0) return `${String(hours)}h ${String(minutes).padStart(2, "0")}m`;
  if (minutes > 0) return `${String(minutes)}m ${String(seconds).padStart(2, "0")}s`;
  return `${String(seconds)}s`;
}

/**
 * Which of the four named phases a run is in — `▪▪▫▫` is "coding", the second of four.
 *
 * This is deliberately not a progress bar. We know the phase a run reported; we do not know how much of it is left,
 * and an agent can sit in one phase for a minute or for twenty. A bar that filled with time would be inventing
 * information, which is the one thing these surfaces may never do.
 */
export function phaseBar(phase: RunPhase | null): string {
  const reached = phase === null ? 0 : PHASES.indexOf(phase) + 1;
  return "▪".repeat(reached) + "▫".repeat(PHASES.length - reached);
}

/** One aligned row per run: what it is, where it is, how long it has been there, and what it has produced. */
export function runTable(runs: readonly RunView[], now: Date): string {
  if (runs.length === 0) return `  No runs yet.\n`;

  const rows = runs.map((run) => {
    const elapsed = elapsedMs(run, now);
    const silent = silentMs(run, now);
    const diff =
      run.diffStat === null
        ? run.files.length === 0
          ? ""
          : `${String(run.files.length)} file${run.files.length === 1 ? "" : "s"}`
        : `+${String(run.diffStat.insertions)} −${String(run.diffStat.deletions)}`;

    return {
      mark: MARKS[run.status],
      runId: run.runId,
      seat: run.seat.id,
      status: run.status,
      bar: phaseBar(run.phase),
      phase: run.phase ?? "",
      elapsed: elapsed === null ? DASH : formatDuration(elapsed),
      diff,
      // A finished run is never "quiet": it is not waiting for anything.
      quiet: silent !== null && silent >= QUIET_AFTER_MS ? `quiet ${formatDuration(silent)}` : "",
    };
  });

  const width = (pick: (row: (typeof rows)[number]) => string): number =>
    Math.max(...rows.map((row) => pick(row).length));
  const w = {
    runId: width((row) => row.runId),
    seat: width((row) => row.seat),
    status: width((row) => row.status),
    elapsed: width((row) => row.elapsed),
    phase: width((row) => row.phase),
  };

  return (
    rows
      .map((row) =>
        [
          `  ${row.mark} ${row.runId.padEnd(w.runId)}`,
          row.seat.padEnd(w.seat),
          row.status.padEnd(w.status),
          `${row.bar} ${row.phase.padEnd(w.phase)}`,
          row.elapsed.padStart(w.elapsed),
          row.diff,
          row.quiet,
        ]
          .filter((cell) => cell !== "")
          .join("  ")
          .trimEnd(),
      )
      .join("\n") + "\n"
  );
}

/** The whole mission as a watcher wants it: the headline first, then a row per run. */
export function missionReport(mission: MissionView, now: Date): string {
  const runs = mission.runOrder.flatMap((runId) => {
    const run = mission.runs[runId];
    return run === undefined ? [] : [run];
  });

  const count = (predicate: (run: RunView) => boolean): number => runs.filter(predicate).length;
  const tallies = [
    [count((run) => run.status === "running"), "running"],
    [count((run) => run.status === "queued"), "queued"],
    [count((run) => run.status === "done"), "done"],
    [count((run) => run.status === "merged"), "merged"],
    [count((run) => run.status === "dropped"), "dropped"],
    [
      count((run) => run.status === "failed" || run.status === "killed" || run.status === "timeout"),
      "ended badly",
    ],
  ] as const;

  const headline = [
    mission.missionId,
    mission.status,
    ...tallies.filter(([n]) => n > 0).map(([n, label]) => `${String(n)} ${label}`),
  ].join(" · ");

  return `${headline}\n${runTable(runs, now)}`;
}

const MARKS: Record<RunView["status"], string> = {
  queued: "◌",
  running: "●",
  done: "✓",
  merged: "✓",
  failed: "✗",
  killed: "✗",
  timeout: "✗",
  conflict: "!",
  dropped: "·",
};
