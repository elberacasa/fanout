import { Ledger, project, type FanoutEventInput } from "fanout-core";
import { describe, expect, it } from "vitest";
import { missionLines } from "../src/format.ts";

/*
 * What a returning session is told about work in other repositories.
 *
 * `fanout status` runs on SessionStart, and it used to end with a bare count: "3 missions in other repositories,
 * not shown." True, and useless — it tells you something is waiting without telling you where, so the only way
 * to act on it was to go and look in every project you have. That was a logged debt on its own, and it became a
 * sharper one when the Stop hook was scoped to the current repository: the hook now deliberately says nothing
 * about elsewhere, so this is the only thing that does.
 *
 * The rule it has to hold: name the repositories with work that is actually waiting, stay quiet about the ones
 * that are merely finished, and never grow without bound.
 */

const mission = (id: string, root: string, runs: readonly FanoutEventInput[]): FanoutEventInput[] => [
  {
    type: "mission.created",
    missionId: id,
    goal: "Do the thing",
    repo: { root, baseCommit: "0".repeat(40) },
    limits: { maxParallel: 2, timeoutMinutes: 30 },
  },
  ...runs,
];

const waiting = (id: string): FanoutEventInput[] => [
  { type: "run.queued", missionId: id, runId: `${id}-1`, lineId: "one", seat: { id: "codex" }, attempt: 1 },
  {
    type: "run.started",
    missionId: id,
    runId: `${id}-1`,
    workdir: "/w",
    argv: ["codex"],
    owner: process.pid,
  },
  { type: "run.finished", missionId: id, runId: `${id}-1`, status: "done", exitCode: 0 },
];

/*
 * Genuinely concluded: the run was merged. The first draft of this helper only marked the *mission* finished
 * and left the run `done` and unreviewed, which is still work waiting on a person — the test was wrong and the
 * code was right, which is worth more than the other way round.
 */
const settled = (id: string): FanoutEventInput[] => [
  ...waiting(id),
  {
    type: "merge.applied",
    missionId: id,
    runId: `${id}-1`,
    revision: "a".repeat(64),
    files: ["src/one.ts"],
    commit: "b".repeat(40),
  },
  { type: "mission.finished", missionId: id, outcome: "completed", summary: "all done" },
];

const shown = (events: readonly FanoutEventInput[], here: string): string => {
  const ledger = Ledger.open(":memory:");
  ledger.appendAll(events);
  const out = missionLines(project(ledger.read()), new Date(), here);
  ledger.close();
  return out;
};

describe("work in other repositories", () => {
  it("names the repository, so you can go there", () => {
    const out = shown(
      [...mission("a", "/work/here", []), ...mission("b", "/work/api", waiting("b"))],
      "/work/here",
    );

    expect(out).toContain("/work/api");
  });

  it("says what is waiting there, not just that something is", () => {
    const out = shown(
      [...mission("a", "/work/here", []), ...mission("b", "/work/api", waiting("b"))],
      "/work/here",
    );

    expect(out).toMatch(/1 waiting for review/);
  });

  /*
   * The discipline that keeps this from becoming the noise it replaced. A mission that finished and merged is
   * not waiting on anybody, and listing it every time a session starts would train people to skip the block.
   */
  it("stays quiet about a repository whose work is finished", () => {
    const out = shown(
      [...mission("a", "/work/here", []), ...mission("b", "/work/done", settled("b"))],
      "/work/here",
    );

    expect(out).not.toContain("/work/done");
  });

  it("still counts repositories it does not list, rather than hiding them", () => {
    const out = shown(
      [...mission("a", "/work/here", []), ...mission("b", "/work/done", settled("b"))],
      "/work/here",
    );

    expect(out).toMatch(/1 mission in other repositories/);
  });

  it("does not grow without bound", () => {
    const many = Array.from({ length: 12 }, (_, index) =>
      mission(`m${String(index)}`, `/work/p${String(index)}`, waiting(`m${String(index)}`)),
    ).flat();

    const out = shown([...mission("a", "/work/here", []), ...many], "/work/here");
    const listed = [...out.matchAll(/\/work\/p\d+/g)].length;

    expect(listed).toBeLessThanOrEqual(5);
    expect(out).toMatch(/more/);
  });
});
