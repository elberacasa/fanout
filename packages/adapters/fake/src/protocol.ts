import { RunProgress } from "fanout-core";
import { z } from "zod";

/*
 * The fake agent's stdout: one JSON object per line. It stands in for a vendor CLI's stream, so the adapter parses it
 * the same way a real adapter parses Codex's or Kimi's output. The CLI writes it and the adapter reads it with this
 * one schema.
 */
export const OutputLine = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("phase"),
    phase: RunProgress.shape.phase,
    detail: z.string().max(500).optional(),
  }),
  z.strictObject({
    kind: z.literal("tool"),
    tool: z.string().min(1).max(100),
    summary: z.string().max(500).optional(),
    files: z.array(z.string().min(1).max(1000)).max(200),
  }),
  z.strictObject({ kind: z.literal("usage"), amount: z.int().nonnegative(), unit: z.literal("messages") }),
  z.strictObject({ kind: z.literal("limit"), message: z.string().min(1).max(500) }),
  z.strictObject({ kind: z.literal("sleep"), ms: z.int().nonnegative() }),
  z.strictObject({ kind: z.literal("report"), text: z.string().max(20_000) }),
]);
export type OutputLine = z.infer<typeof OutputLine>;

/** Exit codes besides the scenario's own. */
export const EXIT = {
  /** A limit step was played: the simulated seat ran out of usage. */
  limit: 2,
  /** Bad arguments or an invalid scenario (EX_USAGE). */
  usage: 64,
  /** The scenario tried to write outside the working directory (EX_DATAERR). */
  unsafeWrite: 65,
  /** Anything unexpected (EX_SOFTWARE). */
  internal: 70,
} as const;
