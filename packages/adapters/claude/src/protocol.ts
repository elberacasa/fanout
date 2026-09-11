import { z } from "zod";

/*
 * Claude Code's stream-json feed, as recorded from version 2.1.269 (fixtures/basic.jsonl).
 *
 * It is the most generous of the streams we drive: an init line naming the session, a rate-limit line with real
 * window utilization, thinking-token estimates as the turn goes, assistant messages whose content blocks carry the
 * tool calls, and a final result line with the answer and the turn's token usage.
 *
 * Only the fields we use are described and unknown extras are allowed, so a new field never breaks a run. The
 * union is discriminated on `type` so that narrowing one line tells us exactly what we may read from it; the
 * several kinds of `system` line differ by `subtype`, which is why its fields are optional here.
 */

export const ToolUse = z.looseObject({
  type: z.literal("tool_use"),
  name: z.string(),
  input: z
    .looseObject({
      file_path: z.string().optional(),
      path: z.string().optional(),
      notebook_path: z.string().optional(),
      command: z.string().optional(),
    })
    .optional(),
});
export type ToolUse = z.infer<typeof ToolUse>;

const Window = z.looseObject({ utilization: z.number(), resetsAt: z.number().optional() });

export const ClaudeLine = z.discriminatedUnion("type", [
  z.looseObject({
    type: z.literal("system"),
    subtype: z.string(),
    session_id: z.string().optional(),
    estimated_tokens_delta: z.number().optional(),
  }),
  z.looseObject({
    type: z.literal("rate_limit_event"),
    rate_limit_info: z.looseObject({
      status: z.string(),
      rateLimitType: z.string().optional(),
      resetsAt: z.number().optional(),
      unifiedWindows: z.record(z.string(), Window).optional(),
    }),
  }),
  z.looseObject({
    type: z.literal("assistant"),
    message: z.looseObject({ content: z.array(z.looseObject({ type: z.string() })) }),
  }),
  z.looseObject({ type: z.literal("user") }),
  z.looseObject({
    type: z.literal("result"),
    subtype: z.string().optional(),
    is_error: z.boolean().optional(),
    result: z.string().optional(),
    usage: z
      .looseObject({ input_tokens: z.number().optional(), output_tokens: z.number().optional() })
      .optional(),
  }),
]);
export type ClaudeLine = z.infer<typeof ClaudeLine>;
