import { pathInScope } from "@fanout/core";
import { git, zeroSeparated } from "./git.ts";

/*
 * What an agent must never receive. Git ignoring a file is not enough on its own: a repository can track a `.env`
 * or a private key, and a worktree of that commit would hand it over. This is checked against the commit itself,
 * before any workspace exists, and it is the same list the safety report shows the user.
 */

export const DEFAULT_DENY_LIST: readonly string[] = [
  "**/.env",
  "**/.env.*",
  "**/*.pem",
  "**/*.key",
  "**/*.p12",
  "**/*.pfx",
  "**/*.keystore",
  "**/id_rsa*",
  "**/id_ed25519*",
  "**/.npmrc",
  "**/.netrc",
  "**/.pgpass",
  "**/.ssh/**",
  "**/.aws/**",
  "**/.gnupg/**",
  "**/secrets.*",
  "**/credentials",
  "**/credentials.*",
  "**/service-account*.json",
];

/** A workspace was not created because the repository holds something an agent must not see. */
export class DenyListError extends Error {
  override name = "DenyListError";
  readonly files: readonly string[];

  constructor(files: readonly string[]) {
    super(
      `The repository tracks ${files.length} file(s) an agent must never receive: ${files.slice(0, 5).join(", ")}` +
        `${files.length > 5 ? ", …" : ""}. Remove them from the commit, or narrow the deny-list on purpose.`,
    );
    this.files = files;
  }
}

/** Tracked files at a commit that the deny-list covers, in the repository's own order. */
export async function deniedFiles(
  repoRoot: string,
  baseCommit: string,
  denyList: readonly string[] = DEFAULT_DENY_LIST,
): Promise<string[]> {
  const tracked = zeroSeparated(
    await git(["ls-tree", "-r", "-z", "--name-only", baseCommit], { cwd: repoRoot }),
  );
  return tracked.filter((file) => denyList.some((pattern) => pathInScope(file, pattern)));
}
