import { isAbsolute, relative } from "node:path";
import {
  AdapterManifest,
  type AdapterContext,
  type FanoutEventInput,
  type LaunchSpec,
  type ParseResult,
  type SeatAdapter,
} from "@fanout/core";
import manifestJson from "../manifest.json" with { type: "json" };
import { GrokLine } from "./protocol.ts";

/*
 * The Grok Build seat, driven through its documented single-turn mode (`grok -p`) with structured output.
 *
 * Its stream (verified against 1.0.13, recorded in fixtures/basic.jsonl) differs from Codex's in two ways that
 * shape this adapter. Prose arrives as a stream of one-word deltas, so the run's report has to be assembled here
 * rather than read from a file — Grok writes none. And the session id arrives only in the final `end` line, so a
 * run is half over before we can name its session.
 */

export const manifest: AdapterManifest = AdapterManifest.parse(manifestJson);

const TEST_COMMAND = /\b(test|vitest|jest|pytest|cargo test|go test|npm run|pnpm run)\b/;
const WRITING = /write|edit|replace|create|patch/i;

export function createGrokAdapter(): SeatAdapter {
  /** Grok streams its prose in pieces; a run's report is all of them, in order, joined. */
  const spoken = new Map<string, string>();

  return {
    id: manifest.id,

    command(context: AdapterContext): LaunchSpec {
      const readOnly = context.line.role === "auditor";
      const args = manifest.headless.args.map((argument) =>
        argument
          .replace("{prompt}", context.line.prompt)
          .replace("{sandbox}", readOnly ? manifest.permissionModes.readOnly : manifest.permissionModes.edit)
          .replace("{workdir}", context.workdir),
      );
      if (context.line.seat.model !== undefined) args.push("-m", context.line.seat.model);
      if (context.line.seat.effort !== undefined) args.push("--reasoning-effort", context.line.seat.effort);

      return { argv: [manifest.binary, ...args], cwd: context.workdir, env: { ...context.baseEnv } };
    },

    parse(text: string, context: AdapterContext): ParseResult {
      const unparsed: ParseResult = { events: [], signals: [{ kind: "unparsed", line: text }] };
      let json: unknown;
      try {
        json = JSON.parse(text);
      } catch {
        return unparsed;
      }
      const parsed = GrokLine.safeParse(json);
      if (!parsed.success) return unparsed;

      const line = parsed.data;
      const run = { missionId: context.missionId, runId: context.runId };

      switch (line.type) {
        case "available_commands":
          return { events: [{ type: "run.progress", ...run, phase: "reading" }], signals: [] };

        case "thought":
          return { events: [], signals: [] };

        case "text":
          spoken.set(context.runId, (spoken.get(context.runId) ?? "") + line.data);
          return { events: [], signals: [] };

        case "tool_call": {
          const tool = line.toolName ?? line.kind ?? "tool";
          const files = toolFiles(line.rawInput, line.locations, context.workdir);
          const command = line.rawInput?.command ?? "";
          const events: FanoutEventInput[] = [
            {
              type: "run.progress",
              ...run,
              phase: TEST_COMMAND.test(command) ? "testing" : WRITING.test(tool) ? "coding" : "reading",
            },
            {
              type: "run.tool",
              ...run,
              tool,
              ...(command === "" ? {} : { summary: command.slice(0, 500) }),
              files,
            },
          ];
          return { events, signals: [] };
        }

        case "tool_call_update":
          return { events: [], signals: [] };

        case "usage":
          return {
            events: [
              {
                type: "run.usage",
                ...run,
                seat: context.line.seat.id,
                amount: line.usage.input_tokens + line.usage.output_tokens,
                unit: "tokens",
                estimated: false,
              },
            ],
            signals: [],
          };

        case "end": {
          const report = spoken.get(context.runId) ?? "";
          spoken.delete(context.runId);
          return {
            events: [{ type: "run.progress", ...run, phase: "reporting" }],
            signals: [
              ...(line.sessionId === undefined ? [] : [{ kind: "session" as const, id: line.sessionId }]),
              ...(report === "" ? [] : [{ kind: "report" as const, text: report }]),
            ],
          };
        }
      }
    },
  };
}

function toolFiles(
  rawInput: { file_path?: string | undefined; path?: string | undefined } | undefined,
  locations: { path: string }[] | undefined,
  workdir: string,
): string[] {
  const paths = [rawInput?.file_path, rawInput?.path, ...(locations ?? []).map((location) => location.path)];
  const seen = new Set<string>();
  for (const path of paths) {
    if (path !== undefined && path !== "") seen.add(repoRelative(path, workdir));
  }
  return [...seen];
}

/** Grok reports absolute paths; our events speak in paths relative to the run's working directory. */
function repoRelative(path: string, workdir: string): string {
  if (!isAbsolute(path)) return path;
  const inside = relative(workdir, path);
  return inside === "" || inside.startsWith("..") ? path : inside;
}
