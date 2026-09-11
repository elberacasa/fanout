import { deniedFiles } from "../workspace/deny.ts";
import { git, zeroSeparated } from "../workspace/git.ts";
import type { RepositoryState, SafetyDependencies } from "./report.ts";

/*
 * What the safety gate needs from the repository itself. Keeping it here means the report stays a pure function of
 * facts, and these two calls are the only place those facts come from.
 */

export interface SafetyDependencyOptions {
  repoRoot: string;
  denyList?: readonly string[];
}

export function createSafetyDependencies(options: SafetyDependencyOptions): SafetyDependencies {
  const inRepo = { cwd: options.repoRoot };

  return {
    deniedFiles: (baseCommit) => deniedFiles(options.repoRoot, baseCommit, options.denyList),

    repositoryState: async (): Promise<RepositoryState> => {
      const head = (await git(["rev-parse", "HEAD"], inRepo)).trim();
      const entries = zeroSeparated(await git(["status", "--porcelain=v1", "-z"], inRepo));
      const dirty: string[] = [];

      for (let index = 0; index < entries.length; index += 1) {
        const entry = entries[index];
        if (entry === undefined) continue;
        const status = entry.slice(0, 2);
        const path = entry.slice(3);
        if (path !== "") dirty.push(path);
        // A rename or copy carries its source as the next entry; both paths count as touched.
        if (status.startsWith("R") || status.startsWith("C")) {
          const source = entries[index + 1];
          if (source !== undefined) {
            dirty.push(source);
            index += 1;
          }
        }
      }

      return { head, dirty };
    },
  };
}
