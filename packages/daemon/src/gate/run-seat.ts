import type { AdapterManifest } from "@fanout/core";
import { baseEnv } from "../env.ts";

/*
 * Running a seat's CLI once, read-only, and getting back what it said.
 *
 * Shared by everything that asks another vendor a question about code it did not write. The environment is an
 * allowlist (see `env.ts`), the mode is the read-only one the seat's own manifest names, and an unsupplied
 * placeholder is removed along with its flag rather than becoming an empty string — a CLI is entitled to reject
 * `-m ""`, and one of them does.
 */

export type SeatExecute = (
  binary: string,
  args: readonly string[],
  options: { cwd: string; timeoutMs: number },
) => Promise<{ stdout: string; stderr: string; exitCode: number }>;

export interface RunSeatOptions {
  manifest: AdapterManifest;
  cwd: string;
  prompt: string;
  model?: string;
  timeoutMs?: number;
  execute?: SeatExecute;
}

export interface SeatAnswer {
  /** False when the CLI could not run, exited non-zero, or said nothing we could read. */
  ok: boolean;
  /** Everything the agent said, joined. Empty when `ok` is false. */
  text: string;
  /** Why it failed, when it did. */
  problem: string;
}

/** Asks a seat a question about the code in `cwd`, read-only, and returns its answer. */
export async function runSeat(options: RunSeatOptions): Promise<SeatAnswer> {
  const { manifest } = options;
  const args = fillTemplate(manifest.headless.args, {
    "{workdir}": options.cwd,
    "{sandbox}": manifest.permissionModes.readOnly,
    "{prompt}": options.prompt,
    ...(options.model === undefined ? {} : { "{model}": options.model }),
  });

  const execute = options.execute ?? runCliOnce;
  let stdout: string;
  try {
    const result = await execute(manifest.binary, args, {
      cwd: options.cwd,
      timeoutMs: options.timeoutMs ?? 10 * 60_000,
    });
    if (result.exitCode !== 0) {
      return { ok: false, text: "", problem: firstLines(result.stderr || result.stdout) };
    }
    stdout = result.stdout;
  } catch (cause) {
    return { ok: false, text: "", problem: cause instanceof Error ? cause.message : String(cause) };
  }

  const text = agentText(stdout);
  // An exit code of zero is not an answer. A CLI that printed nothing we recognise has told us nothing.
  if (text === null) {
    return { ok: false, text: "", problem: "the seat exited cleanly but said nothing we could read" };
  }
  return { ok: true, text, problem: "" };
}

/**
 * What the agent actually said, out of its stream.
 *
 * Null when the stream held no agent message at all — different from an agent that said nothing, and never to be
 * reported as one.
 */
export function agentText(stream: string): string | null {
  const messages: string[] = [];
  for (const line of stream.split("\n")) {
    if (line.trim() === "") continue;
    try {
      const parsed: unknown = JSON.parse(line);
      const item = (parsed as { item?: { type?: string; text?: string } }).item;
      if (item?.type === "agent_message" && typeof item.text === "string") messages.push(item.text);
    } catch {
      // A line that is not JSON is the CLI talking to a human; the answer is in the ones that are.
    }
  }
  return messages.length === 0 ? null : messages.join("\n\n");
}

/**
 * Fills an argument template, dropping any placeholder nobody supplied and the flag in front of it.
 *
 * Found by running this for real: with no model chosen, `["-m", "{model}"]` became `["-m", ""]` and Codex answered
 * `The '' model is not supported`. An unsupplied option must vanish, not become an empty value.
 */
export function fillTemplate(
  template: readonly string[],
  values: Readonly<Record<string, string>>,
): string[] {
  const filled: string[] = [];
  for (const argument of template) {
    const placeholder = /^\{[a-z]+\}$/.test(argument) ? argument : null;
    if (placeholder !== null && !Object.hasOwn(values, placeholder)) {
      if (filled[filled.length - 1]?.startsWith("-") === true) filled.pop();
      continue;
    }
    filled.push(
      Object.entries(values).reduce((text, [name, value]) => text.split(name).join(value), argument),
    );
  }
  return filled;
}

function firstLines(text: string, count = 5): string {
  return text.split("\n").slice(0, count).join("\n").trim();
}

/**
 * Runs the CLI with its standard input closed.
 *
 * Every manifest declares `stdin: "closed"` and this is where that is honoured. Without a terminal, `codex exec`
 * waits on "Reading additional input from stdin…" and never returns — a pipe nobody writes to is not the same as
 * no input at all. It cost an hour of a run that looked busy and was blocked, in code whose own manifest says the
 * rule out loud, which is the argument for honouring declarations rather than remembering them.
 */
export const runCliOnce: SeatExecute = async (binary, args, options) => {
  const { execFile } = await import("node:child_process");

  // Resolved either way; the caller turns a failure into an answer of "we could not ask", never into a verdict.
  const outcome = await new Promise<
    { stdout: string; stderr: string; exitCode: number } | { failure: Error }
  >((settle) => {
    const child = execFile(
      binary,
      [...args],
      {
        cwd: options.cwd,
        timeout: options.timeoutMs,
        env: baseEnv(),
        maxBuffer: 64 * 1024 * 1024,
        windowsHide: true,
      },
      (error, stdout, stderr) => {
        if (error === null) {
          settle({ stdout, stderr, exitCode: 0 });
          return;
        }
        const code = (error as { code?: number }).code;
        // A CLI that answers with a non-zero exit is answering, not failing to run.
        if (typeof code === "number") settle({ stdout, stderr, exitCode: code });
        else settle({ failure: error });
      },
    );
    child.stdin?.end();
  });

  if ("failure" in outcome) throw outcome.failure;
  return outcome;
};
