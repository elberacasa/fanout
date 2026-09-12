import { spawn } from "node:child_process";
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
  timeoutMs?: number;
  /** Injected in tests so nothing needs a real toolchain. */
  run?: (command: string, cwd: string, timeoutMs: number) => Promise<CommandOutcome>;
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
