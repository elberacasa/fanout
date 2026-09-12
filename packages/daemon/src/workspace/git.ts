import { execFile } from "node:child_process";
import { promisify } from "node:util";

/*
 * Every git call the daemon makes. No shell, so a path can never become an argument list; a closed environment, so
 * git cannot prompt for credentials or pick up a helper we did not choose; and a timeout, so a hung git cannot hang
 * a mission.
 */

const run = promisify(execFile);

export class GitError extends Error {
  override name = "GitError";
  readonly args: readonly string[];
  readonly stderr: string;
  readonly exitCode: number | null;

  constructor(args: readonly string[], stderr: string, exitCode: number | null) {
    super(`git ${args.join(" ")} failed${exitCode === null ? "" : ` (exit ${exitCode})`}: ${stderr.trim()}`);
    this.args = args;
    this.stderr = stderr;
    this.exitCode = exitCode;
  }
}

export interface GitOptions {
  cwd: string;
  timeoutMs?: number;
  /** Diffs and file lists can be large; the default holds a very big patch. */
  maxBuffer?: number;
}

export function gitEnv(): Record<string, string> {
  const path = process.env["PATH"];
  const home = process.env["HOME"];
  return {
    ...(path === undefined ? {} : { PATH: path }),
    ...(home === undefined ? {} : { HOME: home }),
    // Never ask a human, never touch a credential helper, never take a lock we don't need, and speak English so
    // that parsing never depends on the user's locale.
    GIT_TERMINAL_PROMPT: "0",
    GIT_ASKPASS: "",
    GIT_OPTIONAL_LOCKS: "0",
    GIT_CONFIG_NOSYSTEM: "1",
    LC_ALL: "C",
  };
}

export async function git(args: readonly string[], options: GitOptions): Promise<string> {
  try {
    const { stdout } = await run("git", [...args], {
      cwd: options.cwd,
      timeout: options.timeoutMs ?? 60_000,
      maxBuffer: options.maxBuffer ?? 256 * 1024 * 1024,
      env: gitEnv(),
      windowsHide: true,
    });
    return stdout;
  } catch (cause) {
    const detail = cause as { stderr?: string; code?: number | null; message?: string };
    throw new GitError(args, detail.stderr ?? detail.message ?? "", detail.code ?? null);
  }
}

/** Lines of output, without the trailing empty one. */
export function lines(output: string): string[] {
  return output.split("\n").filter((line) => line !== "");
}

/** Entries of a `-z` listing, which is the only safe way to read paths that contain spaces or newlines. */
export function zeroSeparated(output: string): string[] {
  return output.split("\0").filter((entry) => entry !== "");
}
