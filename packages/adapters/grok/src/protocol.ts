import { z } from "zod";

/*
 * Grok Build's streaming-json feed, as recorded from version 1.0.13 (fixtures/basic.jsonl). It is a session-update
 * stream: prose and reasoning arrive as many small deltas, tools as a call and later updates, usage once per turn,
 * and the session id only at the very end.
 *
 * Only the fields we use are described and unknown extras are allowed: a vendor adding a field must not break a run.
 */

const Location = z.looseObject({ path: z.string() });

const RawInput = z.looseObject({
  file_path: z.string().optional(),
  path: z.string().optional(),
  command: z.string().optional(),
});

export const GrokLine = z.discriminatedUnion("type", [
  z.looseObject({ type: z.literal("available_commands") }),
  z.looseObject({ type: z.literal("thought"), data: z.string() }),
  z.looseObject({ type: z.literal("text"), data: z.string() }),
  z.looseObject({
    type: z.literal("tool_call"),
    toolCallId: z.string(),
    toolName: z.string().optional(),
    kind: z.string().optional(),
    rawInput: RawInput.optional(),
    locations: z.array(Location).optional(),
  }),
  z.looseObject({
    type: z.literal("tool_call_update"),
    toolCallId: z.string(),
    status: z.string().nullable().optional(),
    locations: z.array(Location).optional(),
  }),
  z.looseObject({
    type: z.literal("usage"),
    usage: z.looseObject({ input_tokens: z.number(), output_tokens: z.number() }),
  }),
  z.looseObject({
    type: z.literal("end"),
    stopReason: z.string().optional(),
    sessionId: z.string().optional(),
  }),
]);
export type GrokLine = z.infer<typeof GrokLine>;
