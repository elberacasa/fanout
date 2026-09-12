import {
  elapsedMs,
  EMPTY_POLICY,
  formatDuration,
  silentMs,
  stanceFor,
  type ProjectionState,
  type SeatInfo,
  type SeatPolicy,
} from "@fanout/core";

/*
 * How the crew reads in a terminal. The rule everywhere: say what is known, say plainly what is not, and never let
 * an unknown look like a yes.
 */

const SIGN_IN: Record<SeatInfo["signedIn"], string> = {
  yes: "signed in",
  no: "not signed in",
  unknown: "unknown",
};

export function crewTable(seats: readonly SeatInfo[], policy: SeatPolicy = EMPTY_POLICY): string {
  if (seats.length === 0) return "No agent CLIs found on this machine.\n";

  const rows = seats.map((seat) => ({
    name: seat.displayName,
    version: seat.version ?? "not installed",
    state: seat.supported ? SIGN_IN[seat.signedIn] : seat.version === null ? "—" : "unsupported version",
    ready: stanceFor(seat, policy).usable,
    // "normal" is what a seat is when nobody has said anything, and printing it down every row would bury the
    // one or two the owner actually decided about.
    posture: stanceFor(seat, policy).posture === "normal" ? "" : stanceFor(seat, policy).posture,
    // Most CLIs do not report a tier. An empty column says that better than a word like "unknown" repeated
    // down the table, and the source travels with the value so nobody has to wonder who said it.
    plan: seat.plan === null ? "" : `${seat.plan.name} (${seat.plan.source})`,
  }));
  const width = {
    name: Math.max(...rows.map((row) => row.name.length)),
    version: Math.max(...rows.map((row) => row.version.length)),
    state: Math.max(...rows.map((row) => row.state.length)),
    plan: Math.max(...rows.map((row) => row.plan.length)),
  };

  const lines = rows.map((row) =>
    (
      `  ${row.ready ? "•" : " "} ${row.name.padEnd(width.name)}  ${row.version.padEnd(width.version)}  ` +
      `${row.state.padEnd(width.state)}  ${row.plan.padEnd(width.plan)}  ${row.posture}`
    ).trimEnd(),
  );
  const ready = rows.filter((row) => row.ready).length;

  return `Crew on this machine (${ready} ready)\n${lines.join("\n")}\n`;
}

export function missionLines(state: ProjectionState, now: Date = new Date()): string {
  const missions = Object.values(state.missions);
  if (missions.length === 0) return "No missions yet.\n";

  const lines = missions.map((mission) => {
    const runs = Object.values(mission.runs);
    const running = runs.filter((run) => run.status === "running" || run.status === "queued").length;
    const merged = runs.filter((run) => run.status === "merged").length;
    const waiting = runs.filter((run) => run.status === "done" && run.review === null).length;
    // A mission where every working run has gone silent is the one worth walking back to the terminal for.
    const quiet = runs.filter((run) => (silentMs(run, now) ?? 0) >= 60_000).length;
    const longest = runs.reduce((most, run) => Math.max(most, elapsedMs(run, now) ?? 0), 0);
    const parts = [
      `${runs.length} run${runs.length === 1 ? "" : "s"}`,
      running > 0 ? `${running} running` : "",
      waiting > 0 ? `${waiting} waiting for review` : "",
      merged > 0 ? `${merged} merged` : "",
      longest > 0 ? formatDuration(longest) : "",
      quiet > 0 ? `${quiet} quiet` : "",
    ].filter((part) => part !== "");
    return `  ${mission.missionId.padEnd(16)} ${mission.status.padEnd(9)} ${parts.join(" · ")}`;
  });

  const anomalies =
    state.anomalies.length === 0
      ? ""
      : `\n  ${state.anomalies.length} event(s) did not fit the story and were kept as anomalies.\n`;

  return `Missions\n${lines.join("\n")}\n${anomalies}`;
}
