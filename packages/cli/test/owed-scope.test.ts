import { Ledger, project, type FanoutEventInput } from "fanout-core";
import { describe, expect, it } from "vitest";
import { whatIsOwed } from "../src/unfinished.ts";

/*
 * Which repository's unfinished work the Stop hook is allowed to mention.
 *
 * `fanout owed` runs after every turn. That is the point of it — a tool the lead chooses to call cannot catch a
 * lead who believes the work is finished — but it also means anything it reports, it reports relentlessly. A run
 * abandoned in one project three weeks ago was being read out at the end of every turn in every other project on
 * the machine, forever, because the ledger is one file per machine and this asked it for everything in it.
 *
 * `missionLines` already learned this: `fanout status` in a scratch repository listed work on a website and on
 * Fanout itself. The lesson never reached the hook, which is the noisier of the two by a very long way.
 */

const missionIn = (id: string, root: string): FanoutEventInput[] => [
  {
    type: "mission.created",
    missionId: id,
    goal: "Do the thing",
    repo: { root, baseCommit: "0".repeat(40) },
    limits: { maxParallel: 2, timeoutMinutes: 30 },
  },
  {
    type: "plan.proposed",
    missionId: id,
    by: "lead",
    plan: {
      lines: [
        {
          id: "one",
          title: "A line",
          role: "builder",
          prompt: "Do it",
          seat: { id: "codex" },
          scope: { write: ["src/**"] },
          dependsOn: [],
          checks: ["npm test"],
          fixesBug: false,
        },
      ],
    },
  },
  { type: "run.queued", missionId: id, runId: `${id}-1`, lineId: "one", seat: { id: "codex" }, attempt: 1 },
  {
    type: "run.started",
    missionId: id,
    runId: `${id}-1`,
    workdir: "/w",
    argv: ["codex"],
    owner: process.pid,
  },
  // Finished, and nobody has reviewed it: exactly the state that is owed and stays owed.
  { type: "run.finished", missionId: id, runId: `${id}-1`, status: "done", exitCode: 0 },
];

const owedIn = (repoRoot?: string): string[] => {
  const ledger = Ledger.open(":memory:");
  ledger.appendAll([...missionIn("here", "/work/here"), ...missionIn("there", "/work/there")]);
  const found = whatIsOwed(Object.values(project(ledger.read()).missions), repoRoot);
  ledger.close();
  return found.map((item) => item.runId);
};

describe("what the Stop hook is allowed to nag about", () => {
  it("mentions only the repository the hook is running in", () => {
    expect(owedIn("/work/here")).toEqual(["here-1"]);
  });

  it("says nothing at all when this repository owes nothing", () => {
    // Silence is the whole contract: a quiet session must stay quiet, or the hook trains people to ignore it.
    expect(owedIn("/work/elsewhere")).toEqual([]);
  });

  it("still reports everything when it does not know where it is", () => {
    // Not a git repository, or git was unhappy. Reporting too much beats reporting nothing.
    expect(owedIn(undefined).sort()).toEqual(["here-1", "there-1"]);
  });
});
