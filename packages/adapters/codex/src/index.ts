import { isAbsolute, relative } from "node:path";
import {
  AdapterManifest,
  type AdapterContext,
  type AdapterSignal,
  type FanoutEventInput,
  type LaunchSpec,
  type ParseResult,
  type SeatAdapter,
} from "@fanout/core";
import manifestJson from "../manifest.json" with { type: "json" };
import { CodexLine, type CodexItem } from "./protocol.ts";

/*
 * The OpenAI Codex seat, driven through `codex exec` — the mode its own documentation describes for
 * non-interactive use. Nothing here touches credentials: sign-in belongs to the CLI, and we only ever ask it.
 *
 * Its stream (verified against 0.154.0, recorded in fixtures/basic.jsonl) is JSONL:
 *   thread.started      the session id
 *   item.started/completed with an item of type command_execution | file_change | agent_message | error
 *   turn.completed      token usage for the turn
 *
 * Two details a hand-written parser would get wrong, both found by recording a real run: file changes carry
 * absolute paths, which we make repo-relative; and Codex emits non-fatal `error` items that must reach the lead
 * rather than being swallowed.
 */

export const manifest: AdapterManifest = AdapterManifest.parse(manifestJson);

const LIMIT = /usage limit|rate limit|quota|too many requests/i;
const TEST_COMMAND = /\b(test|vitest|jest|pytest|cargo test|go test|npm run|pnpm run)\b/;

export function createCodexAdapter(): SeatAdapter {
  return { id: manifest.id, command, parse };
}

function command(context: AdapterContext): LaunchSpec {
  const { line } = context;
  const readOnly = line.role === "auditor";
  const args = manifest.headless.args.map((argument) =>
    argument
      .replace("{workdir}", context.workdir)
      .replace("{sandbox}", readOnly ? manifest.permissionModes.readOnly : manifest.permissionModes.edit)
      .replace("{report}", context.reportPath)
      .replace("{prompt}", line.prompt),
  );

  // An auditor works on an export with no .git, which `codex exec` otherwise refuses to run in.
  if (readOnly) args.splice(args.length - 1, 0, "--skip-git-repo-check");
  if (line.seat.model !== undefined) args.splice(1, 0, "-m", line.seat.model);
  if (line.seat.effort !== undefined) args.splice(1, 0, "-c", `model_reasoning_effort="${line.seat.effort}"`);

  return { argv: [manifest.binary, ...args], cwd: context.workdir, env: { ...context.baseEnv } };
}

function parse(text: string, context: AdapterContext): ParseResult {
  const unparsed: ParseResult = { events: [], signals: [{ kind: "unparsed", line: text }] };
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return unparsed;
  }
  const parsed = CodexLine.safeParse(json);
  if (!parsed.success) return unparsed;

  const run = { missionId: context.missionId, runId: context.runId };
  const line = parsed.data;

  switch (line.type) {
    case "thread.started":
      return {
        events: [{ type: "run.progress", ...run, phase: "reading" }],
        signals: [{ kind: "session", id: line.thread_id }],
      };

    case "turn.started":
      return { events: [], signals: [] };

    case "turn.completed":
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
          { type: "run.progress", ...run, phase: "reporting" },
        ],
        signals: [],
      };

    case "item.started":
    case "item.completed":
      return item(line.type, line.item, context, run);
  }
}

function item(
  lineType: "item.started" | "item.completed",
  value: CodexItem,
  context: AdapterContext,
  run: { missionId: string; runId: string },
): ParseResult {
  const completed = lineType === "item.completed";

  switch (value.type) {
    case "error": {
      const signal: AdapterSignal = LIMIT.test(value.message)
        ? { kind: "limit", message: value.message }
        : { kind: "error", message: value.message };
      return { events: [], signals: [signal] };
    }

    case "agent_message":
      // Every agent message is a report; the last one before the run ends is the run's report.
      return completed
        ? { events: [], signals: [{ kind: "report", text: value.text }] }
        : { events: [], signals: [] };

    case "file_change": {
      if (!completed) return { events: [], signals: [] };
      const files = value.changes.map((change) => repoRelative(change.path, context.workdir));
      const kinds = [...new Set(value.changes.map((change) => change.kind))].join(", ");
      const events: FanoutEventInput[] = [
        { type: "run.progress", ...run, phase: "coding" },
        { type: "run.tool", ...run, tool: "edit", summary: kinds, files },
      ];
      return { events, signals: [] };
    }

    case "command_execution": {
      if (!completed) return { events: [], signals: [] };
      const summary = value.command.slice(0, 500);
      const events: FanoutEventInput[] = [
        ...(TEST_COMMAND.test(value.command)
          ? [{ type: "run.progress" as const, ...run, phase: "testing" as const }]
          : []),
        { type: "run.tool", ...run, tool: "shell", summary, files: [] },
      ];
      return { events, signals: [] };
    }
  }
}

/** Codex reports absolute paths; our events speak in paths relative to the run's working directory. */
function repoRelative(path: string, workdir: string): string {
  if (!isAbsolute(path)) return path;
  const inside = relative(workdir, path);
  return inside === "" || inside.startsWith("..") ? path : inside;
}
