import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/*
 * Where a run's work lives is one rule, and it is written down once.
 *
 * A run's worktree is usually `workspaces/<mission>/<runId>`, and for a reworked run it is not: rework continues
 * in the worktree of the attempt before it, so deriving the path from the run id finds nothing for exactly the
 * runs that most need finding. `locate` knows that, because it reads the `workdir` the run itself recorded.
 *
 * That was fixed once, in `locate`, and `run_diff` went on deriving the path for itself — so a real mission on
 * this repository reached its rework round and then could not show the lead what had come back. This repository
 * has now been bitten five times by one rule with two implementations, which is why the fix is not another
 * careful edit but a test that makes the second copy impossible to add quietly.
 */

const server = readFileSync(new URL("../src/server.ts", import.meta.url), "utf8");

/**
 * The one place allowed to build a workspace path from the convention.
 *
 * Everything else asks `locate`. If you need a new caller, call `locate`; if `locate` cannot answer your case,
 * teach it, and every tool gets the answer at once.
 */
const DERIVES_THE_PATH = "const path = run.workdir ?? join(options.paths.workspaces, missionId, runId);";

/*
 * The two mentions of the workspace root that are not a run's worktree at all. Listed rather than counted, so
 * adding a third means writing down here what it is and why it is not a run.
 */
const NOT_A_RUN = [
  "    workspaceRoot: options.paths.workspaces,",
  '            workdir: join(options.paths.workspaces, "preview", line.id),',
];

describe("finding a run's workspace", () => {
  it("locates a real run's worktree in exactly one place", () => {
    const mentions = server
      .split("\n")
      .filter((row) => row.includes("options.paths.workspaces"))
      .filter((row) => !NOT_A_RUN.includes(row));

    /*
     * One: `locate`. The manager's root is configuration and the safety report's is a path a command would use
     * if it ran, which is why neither is here. Everything that reads a run's actual work asks `locate`.
     */
    expect(mentions).toEqual([`    ${DERIVES_THE_PATH}`]);
  });

  it("reads the workdir the run recorded, rather than trusting the naming convention", () => {
    // `run.workdir` first, the convention only as a fallback. The other order would break rework silently again.
    expect(server).toMatch(/run\.workdir \?\? join\(/);
  });
});
