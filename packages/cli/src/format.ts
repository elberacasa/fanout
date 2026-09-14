import { homedir } from "node:os";

import {
  elapsedMs,
  EMPTY_POLICY,
  formatDuration,
  silentMs,
  stanceFor,
  type MissionView,
  type ProjectionState,
  type SeatInfo,
  type SeatPolicy,
} from "fanout-core";

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

/** How many repositories to name before falling back to a count. Enough to act on, few enough to read. */
const MOST_LISTED = 5;

/**
 * What to say about missions in other repositories.
 *
 * This used to be a bare count — "3 missions in other repositories, not shown" — which is true and useless: it
 * tells you something is waiting without telling you where, so the only way to act on it was to open every
 * project you have. It matters more since the Stop hook was scoped to the current repository, because that hook
 * now deliberately says nothing about elsewhere and this is the only thing that does.
 *
 * Only repositories with work that is actually waiting or still going are named. A mission that finished and
 * merged is waiting on nobody, and listing it at the start of every session is how a useful block becomes one
 * people skip.
 */
function elsewhereNote(missions: readonly MissionView[]): string {
  if (missions.length === 0) return "";

  const byRepo = new Map<string, { waiting: number; running: number }>();
  for (const mission of missions) {
    const tally = byRepo.get(mission.repo.root) ?? { waiting: 0, running: 0 };
    for (const run of Object.values(mission.runs)) {
      if (run.status === "done" && run.review === null) tally.waiting += 1;
      if (run.status === "running" || run.status === "queued") tally.running += 1;
    }
    byRepo.set(mission.repo.root, tally);
  }

  const busy = [...byRepo.entries()]
    .filter(([, tally]) => tally.waiting > 0 || tally.running > 0)
    // Most waiting first: the thing that cannot merge without you is the thing worth walking to.
    .sort((left, right) => right[1].waiting - left[1].waiting || right[1].running - left[1].running);

  const count = `${String(missions.length)} mission${missions.length === 1 ? "" : "s"} in other repositories`;
  if (busy.length === 0) return `\n  ${count}, none of it waiting on you.\n`;

  const lines = busy.slice(0, MOST_LISTED).map(([root, tally]) => {
    const parts = [
      tally.waiting > 0 ? `${String(tally.waiting)} waiting for review` : "",
      tally.running > 0 ? `${String(tally.running)} running` : "",
    ].filter((part) => part !== "");
    return `    ${shorten(root)}  ${parts.join(" · ")}`;
  });

  const rest = busy.length - lines.length;
  const more = rest > 0 ? `\n    and ${String(rest)} more repositories with work waiting` : "";
  return `\n  ${count}:\n${lines.join("\n")}${more}\n`;
}

/** `~` for the home directory, because an absolute path to somewhere familiar is harder to read, not easier. */
function shorten(path: string): string {
  const home = homedir();
  return home !== "" && path.startsWith(`${home}/`) ? `~${path.slice(home.length)}` : path;
}

export function missionLines(state: ProjectionState, now: Date = new Date(), repoRoot?: string): string {
  const all = Object.values(state.missions);
  if (all.length === 0) return "No missions yet.\n";

  /*
   * Only this repository's missions, when we know which repository we are standing in.
   *
   * The ledger is one file for the whole machine, so without this a developer in their own project was shown
   * missions from two unrelated ones — found by running `fanout status` in a scratch repo and being told about
   * work on a website and on Fanout itself. The count of what is elsewhere is still worth a line, because
   * silently hiding a running mission is its own kind of lie.
   */
  const missions = repoRoot === undefined ? all : all.filter((m) => m.repo.root === repoRoot);
  const footnote = elsewhereNote(all.filter((mission) => !missions.includes(mission)));

  if (missions.length === 0) return `No missions in this repository.${footnote}`;

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

  return `Missions\n${lines.join("\n")}\n${footnote}${anomalies}`;
}
