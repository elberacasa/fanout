import { relative } from "node:path";
import { fileURLToPath } from "node:url";
import type { AdapterContext, LaunchSpec, ParseResult, SeatAdapter } from "@fanout/core";
import { Scenario as ScenarioSchema } from "./scenario.ts";
import type { Scenario as ScenarioType } from "./scenario.ts";
interface ScenarioLine {
  kind: string;
  phase?: string;
  detail?: string;
  tool?: string;
  summary?: string;
  files?: string[];
  amount?: number;
  message?: string;
  text?: string;
}
type Phase = "reading" | "coding" | "testing" | "reporting";
function isPhase(value: string): value is Phase {
  return value === "reading" || value === "coding" || value === "testing" || value === "reporting";
}

export function createFakeAdapter(options: {
  scenarioFor: (line: AdapterContext["line"]) => ScenarioType;
}): SeatAdapter {
  return {
    id: "fake",
    command(context): LaunchSpec {
      const scenario = ScenarioSchema.parse(options.scenarioFor(context.line));
      const cliPath = fileURLToPath(new URL("./cli.ts", import.meta.url));
      return {
        argv: [
          process.execPath,
          cliPath,
          "--scenario-json",
          JSON.stringify(scenario),
          "--report",
          relative(context.workdir, context.reportPath),
          context.line.prompt,
        ],
        cwd: context.workdir,
        env: { ...context.baseEnv },
      };
    },
    parse(line, context): ParseResult {
      try {
        const parsed: unknown = JSON.parse(line);
        if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed))
          return { events: [], signals: [{ kind: "unparsed", line }] };
        const value = parsed as ScenarioLine;
        const base = { missionId: context.missionId, runId: context.runId };
        if (value.kind === "phase" && value.phase !== undefined && isPhase(value.phase))
          return {
            events: [
              {
                type: "run.progress",
                ...base,
                phase: value.phase,
                ...(value.detail === undefined ? {} : { detail: value.detail }),
              },
            ],
            signals: [],
          };
        if (value.kind === "tool" && value.tool !== undefined)
          return {
            events: [
              {
                type: "run.tool",
                ...base,
                tool: value.tool,
                ...(value.summary === undefined ? {} : { summary: value.summary }),
                files: value.files ?? [],
              },
            ],
            signals: [],
          };
        if (value.kind === "usage" && value.amount !== undefined)
          return {
            events: [
              {
                type: "run.usage",
                ...base,
                seat: context.line.seat.id,
                amount: value.amount,
                unit: "messages",
                estimated: false,
              },
            ],
            signals: [],
          };
        if (value.kind === "limit" && value.message !== undefined)
          return { events: [], signals: [{ kind: "limit", message: value.message }] };
        if (value.kind === "sleep") return { events: [], signals: [] };
        if (value.kind === "report" && value.text !== undefined)
          return { events: [], signals: [{ kind: "report", text: value.text }] };
        return { events: [], signals: [{ kind: "unparsed", line }] };
      } catch {
        return { events: [], signals: [{ kind: "unparsed", line }] };
      }
    },
  };
}
export { Scenario, ScenarioStep } from "./scenario.ts";
export type { Scenario as ScenarioType } from "./scenario.ts";
