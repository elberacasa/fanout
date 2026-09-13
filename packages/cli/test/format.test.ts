import { Ledger, project, type FanoutEventInput } from "fanout-core";
import { describe, expect, it } from "vitest";
import { missionLines } from "../src/format.ts";

/*
 * The ledger is one file for the whole machine, so a mission list that does not know where it is standing shows
 * a developer work from every other project they have ever run. Found by running `fanout status` in a scratch
 * repository and being told about a website and about Fanout itself.
 */
describe("which repository's missions are shown", () => {
  const missionIn = (id: string, root: string): FanoutEventInput[] => [
    {
      type: "mission.created",
      missionId: id,
      goal: "Do the thing",
      repo: { root, baseCommit: "0".repeat(40) },
      limits: { maxParallel: 2, timeoutMinutes: 30 },
    },
  ];

  const listing = (repoRoot?: string): string => {
    const ledger = Ledger.open(":memory:");
    ledger.appendAll([...missionIn("here-1", "/work/here"), ...missionIn("there-1", "/work/there")]);
    const out = missionLines(project(ledger.read()), new Date(), repoRoot);
    ledger.close();
    return out;
  };

  it("shows only the missions of the repository it was run in", () => {
    const shown = listing("/work/here");

    expect(shown).toContain("here-1");
    expect(shown).not.toContain("there-1");
  });

  it("still says how many are elsewhere, rather than hiding them", () => {
    // Silently dropping a running mission is its own kind of lie; the count is the honest middle.
    expect(listing("/work/here")).toContain("1 mission in other repositories");
  });

  it("shows everything when it does not know where it is", () => {
    const shown = listing(undefined);

    expect(shown).toContain("here-1");
    expect(shown).toContain("there-1");
  });

  it("says so plainly when this repository has none", () => {
    expect(listing("/work/elsewhere")).toContain("No missions in this repository");
  });
});
