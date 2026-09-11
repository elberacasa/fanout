import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { parseArgs } from "node:util";
import { EXIT, type OutputLine } from "./protocol.ts";
import { Scenario } from "./scenario.ts";

/*
 * A deterministic stand-in for an agent CLI:
 *   node src/cli.ts --scenario-json '<json>' --report <path> -- <prompt>
 * It plays the scenario: prints its stream (protocol.ts), really writes files inside its working directory, writes
 * the report (the daemon chooses that path, usually outside the worktree), and exits. Same scenario, same stdout.
 */

class CliError extends Error {
  readonly code: number;

  constructor(code: number, message: string) {
    super(message);
    this.code = code;
  }
}

function readArgs(args: string[]): { scenario: Scenario; reportPath: string } {
  let parsed;
  try {
    parsed = parseArgs({
      args,
      options: { "scenario-json": { type: "string" }, report: { type: "string" } },
      allowPositionals: true,
      strict: true,
    });
  } catch (error) {
    throw new CliError(EXIT.usage, error instanceof Error ? error.message : String(error));
  }
  const { values, positionals } = parsed;
  if (values["scenario-json"] === undefined) throw new CliError(EXIT.usage, "missing --scenario-json");
  if (values.report === undefined || values.report === "") throw new CliError(EXIT.usage, "missing --report");
  if (positionals.join(" ").trim() === "") throw new CliError(EXIT.usage, "missing prompt");

  let json: unknown;
  try {
    json = JSON.parse(values["scenario-json"]);
  } catch {
    throw new CliError(EXIT.usage, "--scenario-json is not valid JSON");
  }
  const scenario = Scenario.safeParse(json);
  if (!scenario.success) throw new CliError(EXIT.usage, `invalid scenario: ${scenario.error.message}`);
  return { scenario: scenario.data, reportPath: values.report };
}

/** Resolves a scenario write path, refusing anything outside the working directory. */
function insideCwd(cwd: string, path: string): string {
  const target = resolve(cwd, path);
  const fromCwd = relative(cwd, target);
  if (isAbsolute(path) || fromCwd === "" || fromCwd === ".." || fromCwd.startsWith(`..${sep}`)) {
    throw new CliError(EXIT.unsafeWrite, `refusing to write outside the working directory: ${path}`);
  }
  return target;
}

function writeFile(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content, "utf8");
}

function emit(line: OutputLine): void {
  process.stdout.write(`${JSON.stringify(line)}\n`);
}

async function play(scenario: Scenario, cwd: string, reportPath: string): Promise<number> {
  const wait = async (ms: number | undefined): Promise<void> => {
    if (ms !== undefined && ms > 0) await sleep(ms * scenario.timeScale);
  };

  for (const step of scenario.steps) {
    if ("sleep" in step) {
      await wait(step.sleep);
      emit({ kind: "sleep", ms: step.sleep });
      continue;
    }
    await wait(step.delayMs);
    if ("phase" in step) {
      emit({
        kind: "phase",
        phase: step.phase,
        ...(step.detail === undefined ? {} : { detail: step.detail }),
      });
    } else if ("tool" in step) {
      const writes = Object.entries(step.write ?? {});
      const targets = writes.map(([path]) => insideCwd(cwd, path));
      writes.forEach(([, content], index) => {
        const target = targets[index];
        if (target !== undefined) writeFile(target, content);
      });
      emit({
        kind: "tool",
        tool: step.tool,
        ...(step.summary === undefined ? {} : { summary: step.summary }),
        files: writes.map(([path]) => path),
      });
    } else if ("usage" in step) {
      emit({ kind: "usage", amount: step.usage, unit: "messages" });
    } else {
      emit({ kind: "limit", message: step.limit });
      writeFile(reportPath, scenario.report);
      return EXIT.limit;
    }
  }

  writeFile(reportPath, scenario.report);
  emit({ kind: "report", text: scenario.report });
  if (scenario.hang) {
    // A pending promise alone lets Node exit; a timer keeps the process alive until it is killed.
    await new Promise<never>(() => setInterval(() => undefined, 60_000));
  }
  return scenario.exitCode;
}

async function main(args: string[]): Promise<number> {
  const { scenario, reportPath } = readArgs(args);
  const cwd = process.cwd();
  return play(scenario, cwd, resolve(cwd, reportPath));
}

main(process.argv.slice(2)).then(
  (code) => {
    process.exitCode = code;
  },
  (error: unknown) => {
    const code = error instanceof CliError ? error.code : EXIT.internal;
    process.stderr.write(`fake seat: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = code;
  },
);
