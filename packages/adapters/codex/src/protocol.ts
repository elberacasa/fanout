import { z } from "zod";

/*
 * Codex's own JSONL stream, as recorded from version 0.154.0 (fixtures/basic.jsonl). Only the fields we use are
 * described, and unknown extras are allowed: a vendor adding a field must never break a run. A line that does not
 * match at all becomes an `unparsed` signal rather than a guess.
 */

const FileChange = z.object({
  id: z.string(),
  type: z.literal("file_change"),
  changes: z.array(z.object({ path: z.string(), kind: z.string() })),
  status: z.string().optional(),
});

const CommandExecution = z.object({
  id: z.string(),
  type: z.literal("command_execution"),
  command: z.string(),
  aggregated_output: z.string().optional(),
  exit_code: z.number().nullable().optional(),
  status: z.string().optional(),
});

const AgentMessage = z.object({ id: z.string(), type: z.literal("agent_message"), text: z.string() });

const ErrorItem = z.object({ id: z.string(), type: z.literal("error"), message: z.string() });

const Item = z.discriminatedUnion("type", [FileChange, CommandExecution, AgentMessage, ErrorItem]);

export const CodexLine = z.discriminatedUnion("type", [
  z.object({ type: z.literal("thread.started"), thread_id: z.string() }),
  z.object({ type: z.literal("turn.started") }),
  z.object({
    type: z.literal("turn.completed"),
    usage: z.object({ input_tokens: z.number(), output_tokens: z.number() }),
  }),
  z.object({ type: z.literal("item.started"), item: Item }),
  z.object({ type: z.literal("item.completed"), item: Item }),
]);
export type CodexLine = z.infer<typeof CodexLine>;
export type CodexItem = z.infer<typeof Item>;
