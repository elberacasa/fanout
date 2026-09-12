import { elapsedMs, formatDuration, silentMs, type ProjectionState, type SeatInfo } from "@fanout/core";

/*
 * How the crew reads in a terminal. The rule everywhere: say what is known, say plainly what is not, and never let
 * an unknown look like a yes.
 */

const SIGN_IN: Record<SeatInfo["signedIn"], string> = {
  yes: "signed in",
  no: "not signed in",
  unknown: "unknown",
};

export function crewTable(seats: readonly SeatInfo[]): string {
  if (seats.length === 0) return "No agent CLIs found on this machine.\n";

  const rows = seats.map((seat) => ({
    name: seat.displayName,
    version: seat.version ?? "not installed",
    state: seat.supported ? SIGN_IN[seat.signedIn] : seat.version === null ? "—" : "unsupported version",
    ready: seat.supported && seat.signedIn === "yes",
  }));
  const width = {
    name: Math.max(...rows.map((row) => row.name.length)),
    version: Math.max(...rows.map((row) => row.version.length)),
  };

  const lines = rows.map(
    (row) =>
      `  ${row.ready ? "•" : " "} ${row.name.padEnd(width.name)}  ${row.version.padEnd(width.version)}  ${row.state}`,
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
