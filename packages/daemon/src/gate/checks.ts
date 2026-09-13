import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, rmSync, symlinkSync, type Dirent } from "node:fs";
import { dirname, join, relative } from "node:path";
import { baseEnv } from "../env.ts";
import { workSnapshot } from "./revision.ts";

/*
 * Running the project's own checks against what an agent actually wrote.
 *
 * The agent already told us its tests pass. That is not evidence: it is the account of the only party with an
 * interest in the answer, produced inside a sandbox that could not open a port or reach a toolchain. So the gate
 * runs the commands itself, in the run's own worktree, and believes the exit codes.
 *
 * The commands come from the plan — which the safety report showed the user before anything launched — and never
 * from an agent. A check an agent could choose is a check an agent can pass.
 */

export interface ChecksOptions {
  /** The worktree holding the agent's changes. */
  cwd: string;
  /** Exactly the commands the plan declared for this line, in order. */
  commands: readonly string[];
  /**
   * The repository the worktree came from. When given, its dependency directories are linked in for the length
   * of the check and removed afterwards — see `withDependencies`.
   */
  repoRoot?: string;
  timeoutMs?: number;
  /** Injected in tests so nothing needs a real toolchain. */
  run?: (command: string, cwd: string, timeoutMs: number) => Promise<CommandOutcome>;
}

/**
 * Directories a project keeps its installed dependencies in.
 *
 * A git worktree contains the tracked files and nothing else, so `npm run test` in one reports
 * `vitest: command not found` — which the gate would otherwise record as the project's checks failing. Found by
 * running the gate against a real agent's work rather than against a fixture.
 *
 * They are lent only while the check runs, never while the agent works. The agent's sandbox can write anywhere in
 * its worktree, and a link to the real `node_modules` would put the developer's installed packages inside the one
 * place an agent is allowed to write. An agent that cannot run the full suite is the expected case, and the
 * reason this gate runs it afterwards.
 */
const DEPENDENCY_NAMES = new Set(["node_modules", ".venv", "vendor"]);

/**
 * Every dependency directory in the repository, not only the one at the top.
 *
 * A workspace puts a package's links inside that package: without `packages/daemon/node_modules`, a test there
 * cannot resolve `fanout-core` however complete the root is. Lending only the root ran 90 of 656 tests — a
 * suite that looks like it ran and did not, which is the most expensive kind of green there is.
 *
 * The depth is generous rather than tight because the first attempt stopped at three and missed
 * `packages/adapters/codex/node_modules` at four, leaving that package's tests unable to import anything. It
 * costs a bounded directory walk that never descends into a dependency directory, and guessing how deeply
 * someone nests their packages is not a guess worth making.
 */
function dependencyDirectories(root: string, depth = 6): string[] {
  if (depth === 0) return [];
  const found: string[] = [];
  let entries: Dirent[];
  try {
    entries = readdirSync(root, { withFileTypes: true });
  } catch {
    return found;
  }
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith(".git")) continue;
    if (DEPENDENCY_NAMES.has(entry.name)) {
      found.push(join(root, entry.name));
      continue; // Never descend into one: its own node_modules are its business.
    }
    found.push(...dependencyDirectories(join(root, entry.name), depth - 1));
  }
  return found;
}

export interface CommandOutcome {
  exitCode: number | null;
  /** Combined output, newest-relevant last, capped. */
  output: string;
  timedOut: boolean;
}

export interface ChecksResult {
  ok: boolean;
  /** What the work looked like when these commands ran, so a merge can refuse a diff that has moved since. */
  revision: string;
  commands: string[];
  summary: string;
  /** Per command, so a person can see which one broke without reading everything. */
  outcomes: { command: string; exitCode: number | null; timedOut: boolean; tail: string }[];
}

const MAX_OUTPUT = 64 * 1024;

/**
 * Runs every declared check, stopping at the first failure.
 *
 * Stopping early is deliberate: the second command's output after the first has failed is noise, and the answer
 * to "may this merge" was already settled by the first. Nothing is "ok" by default — a line with no checks
 * declared is reported as exactly that, not as a pass, because "nothing failed" and "nothing ran" are different
 * facts and only one of them is evidence.
 */
export async function runChecks(options: ChecksOptions): Promise<ChecksResult> {
  const snapshot = await workSnapshot({ cwd: options.cwd });
  const run = options.run ?? runCommand;
  const commands = [...options.commands];
  const outcomes: ChecksResult["outcomes"] = [];

  if (commands.length === 0) {
    return {
      ok: false,
      revision: snapshot.revision,
      commands,
      summary: "no checks were declared for this line, so nothing was verified",
      outcomes,
    };
  }

  const unlink =
    options.repoRoot === undefined ? () => undefined : lendDependencies(options.repoRoot, options.cwd);
  try {
    for (const command of commands) {
      const outcome = await run(command, options.cwd, options.timeoutMs ?? 10 * 60_000);
      outcomes.push({
        command,
        exitCode: outcome.exitCode,
        timedOut: outcome.timedOut,
        tail: lastLines(outcome.output),
      });
      if (outcome.timedOut || outcome.exitCode !== 0) {
        return {
          ok: false,
          revision: snapshot.revision,
          commands,
          summary: outcome.timedOut
            ? `\`${command}\` did not finish in time`
            : `\`${command}\` exited ${String(outcome.exitCode)}`,
          outcomes,
        };
      }
    }

    return {
      ok: true,
      revision: snapshot.revision,
      commands,
      summary: `${String(commands.length)} check${commands.length === 1 ? "" : "s"} passed`,
      outcomes,
    };
  } finally {
    unlink();
  }
}

/**
 * Links a repository's dependency directories into a worktree, and returns how to take them away again.
 *
 * A link rather than a copy, because `node_modules` is enormous and this happens on every check. Removed in a
 * `finally` so a failing check does not leave the developer's installed packages reachable from a directory an
 * agent may later be allowed to write to.
 */
function lendDependencies(repoRoot: string, worktree: string): () => void {
  const lent: string[] = [];
  for (const source of dependencyDirectories(repoRoot)) {
    const destination = join(worktree, relative(repoRoot, source));
    if (existsSync(destination)) continue;
    try {
      mkdirSync(dirname(destination), { recursive: true });
      symlinkSync(source, destination, "dir");
      lent.push(destination);
    } catch {
      // Nothing lent and nothing to clean up: the check will say what it could not find.
    }
  }
  return () => {
    for (const path of lent) rmSync(path, { force: true });
  };
}

/**
 * Runs one command the way a person would, and kills it if it will not stop.
 *
 * A shell, because the checks people write are shell (`npm run check && npm run lint`), and the user saw the
 * exact strings in the safety report before any of this started. The environment is the same allowlist agents
 * get, so a check cannot quietly depend on a secret in the developer's shell and then fail on someone else's
 * machine. Output is capped: a check that prints a hundred megabytes should not be able to exhaust the daemon.
 *
 * It runs in its own process group, and the deadline kills the group rather than the shell. Found by CI on Linux
 * while macOS passed: `sh -c "sleep 30"` leaves `sleep` as a child of the shell, so killing the shell leaves a
 * grandchild alive holding the pipes open and the promise never settles. A check that spawns anything — and every
 * real one does, that is what `npm test` is — could have hung the gate forever.
 */
async function runCommand(command: string, cwd: string, timeoutMs: number): Promise<CommandOutcome> {
  return new Promise<CommandOutcome>((resolve) => {
    const child = spawn(command, {
      cwd,
      shell: true,
      env: { ...baseEnv(), CI: "1" },
      stdio: ["ignore", "pipe", "pipe"],
      // Its own process group, so the whole tree can be signalled and not just the shell at the top of it.
      detached: true,
    });

    let output = "";
    let timedOut = false;

    /** Signals every descendant. A check's children are the check. */
    const signalGroup = (signal: NodeJS.Signals): void => {
      if (child.pid === undefined) return;
      try {
        process.kill(-child.pid, signal);
      } catch {
        // Already gone: nothing to signal and nothing to report.
      }
    };
    const keep = (chunk: Buffer): void => {
      if (output.length < MAX_OUTPUT) output += chunk.toString().slice(0, MAX_OUTPUT - output.length);
    };
    child.stdout.on("data", keep);
    child.stderr.on("data", keep);

    const deadline = setTimeout(() => {
      timedOut = true;
      signalGroup("SIGTERM");
      // A check that ignores SIGTERM is a check that has stopped being one.
      const escalate = setTimeout(() => {
        signalGroup("SIGKILL");
      }, 5_000);
      escalate.unref();
    }, timeoutMs);
    deadline.unref();

    child.on("error", (error) => {
      clearTimeout(deadline);
      resolve({ exitCode: null, output: `${output}\n${error.message}`, timedOut });
    });
    /*
     * `exit` rather than `close`: close waits for every pipe to end, and an orphan holding stdout open would make
     * a killed command look like a running one forever. The output we have when it exits is the output there is.
     */
    child.on("exit", (code) => {
      clearTimeout(deadline);
      resolve({ exitCode: code, output, timedOut });
    });
  });
}

/** The end of the output, which is where a failing command says why. */
function lastLines(output: string, count = 20): string {
  return output.split("\n").filter(Boolean).slice(-count).join("\n");
}
