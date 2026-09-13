import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { AdapterContext, ParseResult, SeatAdapter } from "fanout-core";
import { OutputLine } from "./protocol.ts";
import { Scenario, type ScenarioInput } from "./scenario.ts";

/*
 * The fake seat: a deterministic simulated agent for the offline demo and for every test that needs an agent without
 * an account. It is a seat like any other: `command()` starts its CLI, `parse()` reads its stream.
 */

/**
 * The simulated agent's own executable, wherever this module happens to be running from.
 *
 * Three places, and each one is a lesson rather than a configuration:
 *
 * 1. `fake-agent.js` beside us means we are inside the published bundle, where every workspace package has been
 *    compiled into one file. `./cli.js` there is the *lead's* CLI — spawning it would make the demo run itself.
 * 2. `./cli.ts` is a checkout, where Node runs our TypeScript directly.
 * 3. `./cli.js` is the unbundled compiled layout.
 *
 * A path built as a string is the one import a compiler cannot rewrite, which is why this is worked out at
 * runtime: an earlier version wrote `./cli.ts` into `dist`, and all three demo agents died on the first spawn.
 */
export const FAKE_CLI_PATH = resolveFakeCli();

function resolveFakeCli(): string {
  const bundled = fileURLToPath(new URL("./fake-agent.js", import.meta.url));
  if (existsSync(bundled)) return bundled;
  return fileURLToPath(new URL(import.meta.url.endsWith(".ts") ? "./cli.ts" : "./cli.js", import.meta.url));
}

export interface FakeAdapterOptions {
  /** The scenario a plan line plays. */
  scenarioFor: (line: AdapterContext["line"]) => ScenarioInput;
}

export function createFakeAdapter(options: FakeAdapterOptions): SeatAdapter {
  return {
    id: "fake",
    command: (context) => ({
      argv: [
        process.execPath,
        FAKE_CLI_PATH,
        "--scenario-json",
        JSON.stringify(Scenario.parse(options.scenarioFor(context.line))),
        "--report",
        context.reportPath,
        "--",
        context.line.prompt,
      ],
      cwd: context.workdir,
      env: { ...context.baseEnv },
    }),
    parse: parseLine,
  };
}

/** Maps one line of the fake agent's stdout. Never throws: anything unexpected is an `unparsed` signal. */
export function parseLine(text: string, context: AdapterContext): ParseResult {
  const unparsed: ParseResult = { events: [], signals: [{ kind: "unparsed", line: text }] };
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return unparsed;
  }
  const parsed = OutputLine.safeParse(json);
  if (!parsed.success) return unparsed;

  const line = parsed.data;
  const run = { missionId: context.missionId, runId: context.runId };
  switch (line.kind) {
    case "phase":
      return {
        events: [
          {
            type: "run.progress",
            ...run,
            phase: line.phase,
            ...(line.detail === undefined ? {} : { detail: line.detail }),
          },
        ],
        signals: [],
      };
    case "tool":
      return {
        events: [
          {
            type: "run.tool",
            ...run,
            tool: line.tool,
            ...(line.summary === undefined ? {} : { summary: line.summary }),
            files: line.files,
          },
        ],
        signals: [],
      };
    case "usage":
      return {
        events: [
          {
            type: "run.usage",
            ...run,
            seat: context.line.seat.id,
            amount: line.amount,
            unit: line.unit,
            estimated: false,
          },
        ],
        signals: [],
      };
    case "limit":
      return { events: [], signals: [{ kind: "limit", message: line.message }] };
    case "sleep":
      return { events: [], signals: [] };
    case "report":
      return { events: [], signals: [{ kind: "report", text: line.text }] };
  }
}

export { EXIT, OutputLine } from "./protocol.ts";
export { Scenario, ScenarioStep, type ScenarioInput } from "./scenario.ts";
