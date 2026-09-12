import { describe, expect, it } from "vitest";
import {
  formatDuration,
  missionReport,
  phaseBar,
  project,
  runTable,
  type FanoutEventInput,
  Ledger,
  type StoredEvent,
} from "../src/index.ts";
import { samples } from "./fixtures/events.ts";

const M = "csv-export";

function at(...isoTimes: string[]): (inputs: FanoutEventInput[]) => StoredEvent[] {
  let i = 0;
  return (inputs) => {
    const ledger = Ledger.open(":memory:", {
      now: () => new Date(isoTimes[Math.min(i++, isoTimes.length - 1)] ?? ""),
    });
    const stored = ledger.appendAll(inputs);
    ledger.close();
    return stored;
  };
}

describe("formatDuration", () => {
  it("stays readable at every scale a run reaches", () => {
    expect(formatDuration(0)).toBe("0s");
    expect(formatDuration(9_000)).toBe("9s");
    expect(formatDuration(59_000)).toBe("59s");
    expect(formatDuration(60_000)).toBe("1m 00s");
    expect(formatDuration(398_000)).toBe("6m 38s");
    expect(formatDuration(3_599_000)).toBe("59m 59s");
    expect(formatDuration(3_600_000)).toBe("1h 00m");
    expect(formatDuration(7_530_000)).toBe("2h 05m");
  });

  it("rounds down, so a run never looks further along than it is", () => {
    expect(formatDuration(1_999)).toBe("1s");
    expect(formatDuration(119_999)).toBe("1m 59s");
  });
});

describe("phaseBar", () => {
  /*
   * The bar shows which named phase a run is in, never how complete it is. We cannot know how much work is left,
   * and a bar that implied we did would be the dishonest kind of progress indicator.
   */
  it("marks the position of the current phase among the four", () => {
    expect(phaseBar("reading")).toBe("▪▫▫▫");
    expect(phaseBar("coding")).toBe("▪▪▫▫");
    expect(phaseBar("testing")).toBe("▪▪▪▫");
    expect(phaseBar("reporting")).toBe("▪▪▪▪");
  });

  it("claims nothing for a run that has not said where it is", () => {
    expect(phaseBar(null)).toBe("▫▫▫▫");
  });
});

describe("runTable", () => {
  const started = [
    samples["mission.created"],
    { type: "run.queued", missionId: M, runId: "page-1", lineId: "page", seat: { id: "codex" }, attempt: 1 },
    { type: "run.started", missionId: M, runId: "page-1", workdir: "/w/page-1", argv: ["codex", "exec"] },
    { type: "run.progress", missionId: M, runId: "page-1", phase: "coding" },
  ] satisfies FanoutEventInput[];

  it("shows elapsed time, so a slow run cannot hide as a fast one", () => {
    const state = project(
      at(
        "2026-09-12T10:00:00Z",
        "2026-09-12T10:00:00Z",
        "2026-09-12T10:00:00Z",
        "2026-09-12T10:00:30Z",
      )(started),
    );
    const runs = Object.values(state.missions[M]?.runs ?? {});

    const table = runTable(runs, new Date("2026-09-12T10:02:00Z"));
    expect(table).toContain("page-1");
    expect(table).toContain("codex");
    expect(table).toContain("coding");
    expect(table).toContain("2m 00s");
  });

  it("says a running run has gone quiet once the silence is worth noticing", () => {
    const state = project(
      at(
        "2026-09-12T10:00:00Z",
        "2026-09-12T10:00:00Z",
        "2026-09-12T10:00:00Z",
        "2026-09-12T10:00:30Z",
      )(started),
    );
    const runs = Object.values(state.missions[M]?.runs ?? {});

    // Thirty seconds of thinking is just an agent working.
    expect(runTable(runs, new Date("2026-09-12T10:01:00Z"))).not.toContain("quiet");
    // Six minutes of nothing is the fact that decides whether to wait or to kill.
    expect(runTable(runs, new Date("2026-09-12T10:06:30Z"))).toContain("quiet 6m 00s");
  });

  it("never calls a finished run quiet, because it is not waiting, it is over", () => {
    const state = project(
      at(
        "2026-09-12T10:00:00Z",
        "2026-09-12T10:00:00Z",
        "2026-09-12T10:00:00Z",
        "2026-09-12T10:00:30Z",
        "2026-09-12T10:03:00Z",
      )([...started, { type: "run.finished", missionId: M, runId: "page-1", status: "done", exitCode: 0 }]),
    );
    const runs = Object.values(state.missions[M]?.runs ?? {});

    const table = runTable(runs, new Date("2026-09-12T18:00:00Z"));
    expect(table).not.toContain("quiet");
    // Hours later, the run still took exactly as long as it took.
    expect(table).toContain("3m 00s");
  });

  it("shows a dash rather than a zero for a run that has not started", () => {
    const state = project(at("2026-09-12T10:00:00Z")(started.slice(0, 2)));
    const runs = Object.values(state.missions[M]?.runs ?? {});

    const table = runTable(runs, new Date("2026-09-12T10:30:00Z"));
    expect(table).toContain("queued");
    expect(table).not.toContain("0s");
    expect(table).toContain("—");
  });

  it("lines up its columns whatever the run and seat names are", () => {
    const state = project(
      at("2026-09-12T10:00:00Z")([
        samples["mission.created"],
        { type: "run.queued", missionId: M, runId: "a", lineId: "a", seat: { id: "codex" }, attempt: 1 },
        {
          type: "run.queued",
          missionId: M,
          runId: "a-much-longer-run-id",
          lineId: "b",
          seat: { id: "claude" },
          attempt: 1,
        },
      ]),
    );
    const runs = Object.values(state.missions[M]?.runs ?? {});

    const lines = runTable(runs, new Date("2026-09-12T10:00:00Z")).split("\n").filter(Boolean);
    expect(lines).toHaveLength(2);
    const statusColumn = lines.map((line) => line.indexOf("queued"));
    expect(statusColumn[0]).toBe(statusColumn[1]);
  });

  it("says so plainly when there are no runs, instead of printing an empty frame", () => {
    expect(runTable([], new Date())).toContain("No runs");
  });
});

describe("missionReport", () => {
  it("leads with what the watcher wants first: what is happening and for how long", () => {
    const state = project(
      at(
        "2026-09-12T10:00:00Z",
        "2026-09-12T10:00:00Z",
        "2026-09-12T10:00:00Z",
        "2026-09-12T10:00:30Z",
        "2026-09-12T10:03:00Z",
      )([
        samples["mission.created"],
        { type: "run.queued", missionId: M, runId: "r1", lineId: "l1", seat: { id: "codex" }, attempt: 1 },
        { type: "run.started", missionId: M, runId: "r1", workdir: "/w/r1", argv: ["codex", "exec"] },
        { type: "run.progress", missionId: M, runId: "r1", phase: "coding" },
        { type: "run.finished", missionId: M, runId: "r1", status: "done", exitCode: 0 },
      ]),
    );
    const mission = state.missions[M];
    if (mission === undefined) throw new Error("no mission");

    const report = missionReport(mission, new Date("2026-09-12T10:05:00Z"));
    expect(report).toContain(M);
    expect(report).toContain("1 done");
    expect(report).toContain("r1");
  });
});
