import { isAbsolute, relative } from "node:path";
import {
  AdapterManifest,
  type AdapterContext,
  type AdapterSignal,
  type FanoutEventInput,
  type LaunchSpec,
  type ParseResult,
  type SeatAdapter,
} from "fanout-core";
import manifestJson from "../manifest.json" with { type: "json" };
import { ClaudeLine, ToolUse } from "./protocol.ts";

/*
 * The Claude Code seat, as a worker. It is opt-in (DECISIONS 0009): the lead already spends this subscription on
 * planning and reviewing, and the point of a crew is to put the other subscriptions to work.
 *
 * Driven through `claude -p`, the documented non-interactive mode. Permission prompts are denied rather than
 * bypassed: a run that would need a human is refused, never waved through.
 *
 * Its stream is the only one that reports a real quota window (how full the five-hour and seven-day windows are,
 * and when they reset), which is exactly what routing needs and what every other seat makes us estimate.
 */

export const manifest: AdapterManifest = AdapterManifest.parse(manifestJson);

const WRITING = /^(write|edit|multiedit|notebookedit|update)$/i;
const READING = /^(read|grep|glob|ls|search|webfetch|websearch)$/i;
const TEST_COMMAND = /\b(test|vitest|jest|pytest|cargo test|go test|npm run|pnpm run)\b/;

export function createClaudeAdapter(): SeatAdapter {
  return {
    id: manifest.id,

    command(context: AdapterContext): LaunchSpec {
      const readOnly = context.line.role === "auditor";
      const args = manifest.headless.args.map((argument) =>
        argument
          .replace("{prompt}", context.line.prompt)
          .replace("{sandbox}", readOnly ? manifest.permissionModes.readOnly : manifest.permissionModes.edit),
      );
      if (context.line.seat.model !== undefined) args.push("--model", context.line.seat.model);
      if (context.line.seat.effort !== undefined) args.push("--effort", context.line.seat.effort);

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
      const parsed = ClaudeLine.safeParse(json);
      if (!parsed.success) return unparsed;

      const line = parsed.data;
      const run = { missionId: context.missionId, runId: context.runId };

      if (line.type === "system" && line.subtype === "init" && line.session_id !== undefined) {
        return {
          events: [{ type: "run.progress", ...run, phase: "reading" }],
          signals: [{ kind: "session", id: line.session_id }],
        };
      }

      if (
        line.type === "system" &&
        line.subtype === "thinking_tokens" &&
        line.estimated_tokens_delta !== undefined
      ) {
        return {
          events: [
            {
              type: "run.usage",
              ...run,
              seat: context.line.seat.id,
              amount: Math.max(0, line.estimated_tokens_delta),
              unit: "tokens",
              estimated: true,
            },
          ],
          signals: [],
        };
      }

      if (line.type === "rate_limit_event")
        return { events: [], signals: quotaSignals(line.rate_limit_info) };

      if (line.type === "assistant") {
        const events: FanoutEventInput[] = [];
        for (const raw of line.message.content) {
          const parsedBlock = ToolUse.safeParse(raw);
          if (!parsedBlock.success) continue; // thinking and text blocks say nothing about what the run did
          const block = parsedBlock.data;
          const input = block.input;
          const command = input?.command ?? "";
          const files = [input?.file_path, input?.path, input?.notebook_path]
            .filter((path): path is string => path !== undefined && path !== "")
            .map((path) => repoRelative(path, context.workdir));

          events.push({ type: "run.progress", ...run, phase: phaseOf(block.name, command) });
          events.push({
            type: "run.tool",
            ...run,
            tool: block.name,
            ...(command === "" ? {} : { summary: command.slice(0, 500) }),
            files,
          });
        }
        return { events, signals: [] };
      }

      if (line.type === "result") {
        const usage = line.usage;
        const tokens = (usage?.input_tokens ?? 0) + (usage?.output_tokens ?? 0);
        return {
          events: [
            ...(tokens > 0
              ? [
                  {
                    type: "run.usage" as const,
                    ...run,
                    seat: context.line.seat.id,
                    amount: tokens,
                    unit: "tokens" as const,
                    estimated: false,
                  },
                ]
              : []),
            { type: "run.progress", ...run, phase: "reporting" },
          ],
          signals: [
            ...(line.result === undefined || line.result === ""
              ? []
              : [{ kind: "report" as const, text: line.result }]),
            ...(line.is_error === true
              ? [{ kind: "error" as const, message: line.result ?? "the run ended with an error" }]
              : []),
          ],
        };
      }

      // "user" lines carry tool results, which the tool call already told us about.
      return { events: [], signals: [] };
    },
  };
}

/** Claude reports how full each window is, and when it resets: real numbers the crew never has to estimate. */
function quotaSignals(info: {
  status: string;
  rateLimitType?: string | undefined;
  resetsAt?: number | undefined;
  unifiedWindows?: Record<string, { utilization: number; resetsAt?: number | undefined }> | undefined;
}): AdapterSignal[] {
  const signals: AdapterSignal[] = Object.entries(info.unifiedWindows ?? {}).map(([window, value]) => ({
    kind: "quota",
    window,
    utilization: value.utilization,
    ...(value.resetsAt === undefined ? {} : { resetsAt: asIso(value.resetsAt) }),
  }));

  if (info.status !== "allowed") {
    signals.push({
      kind: "limit",
      message: `Claude reported the ${info.rateLimitType ?? "usage"} window as ${info.status}`,
      ...(info.resetsAt === undefined ? {} : { resetsAt: asIso(info.resetsAt) }),
    });
  }
  return signals;
}

/** The CLI counts in seconds since the epoch; events speak ISO. */
function asIso(seconds: number): string {
  return new Date(seconds * 1000).toISOString();
}

function phaseOf(tool: string, command: string): "reading" | "coding" | "testing" {
  if (TEST_COMMAND.test(command)) return "testing";
  if (WRITING.test(tool)) return "coding";
  if (READING.test(tool)) return "reading";
  return "coding";
}

/** Claude reports absolute paths; our events speak in paths relative to the run's working directory. */
function repoRelative(path: string, workdir: string): string {
  if (!isAbsolute(path)) return path;
  const inside = relative(workdir, path);
  return inside === "" || inside.startsWith("..") ? path : inside;
}
