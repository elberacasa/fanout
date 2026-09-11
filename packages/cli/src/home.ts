import { homedir } from "node:os";
import { join } from "node:path";

/*
 * Everything Fanout keeps lives in one directory, and only there: the ledger, the token, run logs and workspaces.
 * `FANOUT_HOME` moves the lot, which is how tests get their own and how someone can keep it off a synced folder.
 */

export interface FanoutHome {
  root: string;
  ledger: string;
  token: string;
  workspaces: string;
  runs: string;
}

export function fanoutHome(env: Readonly<Record<string, string | undefined>> = process.env): FanoutHome {
  const root = env["FANOUT_HOME"] ?? join(env["HOME"] ?? homedir(), ".fanout");
  return {
    root,
    ledger: join(root, "ledger.db"),
    token: join(root, "token"),
    workspaces: join(root, "workspaces"),
    runs: join(root, "runs"),
  };
}
