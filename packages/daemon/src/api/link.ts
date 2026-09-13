import { readFileSync } from "node:fs";
import { join } from "node:path";

/*
 * Finding the long-running daemon, if there is one.
 *
 * A mission launched from a Claude Code session dies with that session, because the runner lives inside the
 * session's MCP server (ADR 0024). The way out is for the runner to live somewhere that outlives a terminal —
 * `fanout daemon`, which already runs for as long as you leave it — and for the session to ask it rather than do
 * the work itself.
 *
 * This is the asking half: where is it, and is it really there. Two checks, because either alone lies. The file
 * says where a daemon *was*: it survives a crash, a reboot and a kill -9, so a url alone is a guess. The process
 * says something is alive at that id, which after a reboot may be something else entirely. Together they are
 * good enough to try, and the request itself is the final word.
 */

export interface DaemonLink {
  url: string;
  /** The daemon's own token, which every request to it must carry. */
  token: string;
  pid: number;
}

/**
 * The daemon this machine is running, or null when there is none to talk to.
 *
 * Never throws. A missing file, a stale file, a file somebody edited by hand and a daemon that died an hour ago
 * are all the same answer to the caller — there is nobody to ask — and turning any of them into an exception
 * would make "no daemon" look like a failure rather than the ordinary case it is.
 */
export function findDaemon(home: string): DaemonLink | null {
  let advertised: unknown;
  try {
    advertised = JSON.parse(readFileSync(join(home, "daemon.json"), "utf8"));
  } catch {
    return null;
  }

  const { url, pid } = advertised as { url?: unknown; pid?: unknown };
  if (typeof url !== "string" || url === "" || typeof pid !== "number" || !Number.isInteger(pid)) return null;

  /*
   * `EPERM` means the process exists and belongs to somebody else — alive, and quite possibly another user's
   * daemon on a shared machine. Only `ESRCH` is proof that the id advertised in the file is nobody.
   */
  try {
    process.kill(pid, 0);
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code !== "EPERM") return null;
  }

  let token: string;
  try {
    token = readFileSync(join(home, "token"), "utf8").trim();
  } catch {
    return null;
  }
  if (token === "") return null;

  return { url, token, pid };
}

/** Whether the daemon at this link answers. The only check that proves anything; the rest is prologue. */
export async function daemonAnswers(link: DaemonLink, timeoutMs = 1500): Promise<boolean> {
  try {
    const response = await fetch(`${link.url}/health`, { signal: AbortSignal.timeout(timeoutMs) });
    return response.ok;
  } catch {
    return false;
  }
}
