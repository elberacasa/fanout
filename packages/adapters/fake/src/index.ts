import { fileURLToPath } from "node:url";
import type { AdapterContext, ParseResult, SeatAdapter } from "@fanout/core";
import { OutputLine } from "./protocol.ts";
import { Scenario, type ScenarioInput } from "./scenario.ts";

/*
 * The fake seat: a deterministic simulated agent for the offline demo and for every test that needs an agent without
 * an account. It is a seat like any other: `command()` starts its CLI, `parse()` reads its stream.
 */

/*
 * Its own extension, not a written-down one.
 *
 * A path built as a string is the one import the compiler cannot rewrite: `./cli.ts` stayed `./cli.ts` in the
 * published `dist`, where the file beside it is `cli.js`, and all three demo agents died on the first spawn with
 * `Cannot find module …/dist/cli.ts`. A checkout never sees it, because there the string is right. Found by
 * installing the tarball into an empty directory and running the demo the way a stranger would.
 */
export const FAKE_CLI_PATH = fileURLToPath(
  new URL(import.meta.url.endsWith(".ts") ? "./cli.ts" : "./cli.js", import.meta.url),
);

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
