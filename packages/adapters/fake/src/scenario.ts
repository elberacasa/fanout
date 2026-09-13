import { RunProgress } from "fanout-core";
import { z } from "zod";

/*
 * What the fake agent does, step by step. Deterministic by design: no randomness, no clock in the output.
 * Example:
 *   { "steps": [ { "phase": "reading", "delayMs": 300 },
 *                { "tool": "edit", "summary": "add csv writer", "write": { "src/api/csv.ts": "export …" } },
 *                { "usage": 2 }, { "limit": "usage limit reached" } ],
 *     "report": "Added the endpoint.", "exitCode": 0, "timeScale": 0.2 }
 */

const Delay = z.int().nonnegative().max(60_000).optional();

const PhaseStep = z.strictObject({
  phase: RunProgress.shape.phase,
  detail: z.string().max(500).optional(),
  delayMs: Delay,
});

const ToolStep = z.strictObject({
  tool: z.string().min(1).max(100),
  summary: z.string().max(500).optional(),
  /** Files to really write, relative to the working directory, with their content. */
  write: z.record(z.string().min(1).max(1000), z.string().max(1_000_000)).optional(),
  delayMs: Delay,
});

const UsageStep = z.strictObject({ usage: z.int().nonnegative().max(1_000_000), delayMs: Delay });

/** The seat runs out of usage: the agent prints the message, writes its report and exits with code 2. */
const LimitStep = z.strictObject({ limit: z.string().min(1).max(500), delayMs: Delay });

const SleepStep = z.strictObject({ sleep: z.int().nonnegative().max(60_000) });

export const ScenarioStep = z.union([PhaseStep, ToolStep, UsageStep, LimitStep, SleepStep]);
export type ScenarioStep = z.infer<typeof ScenarioStep>;

export const Scenario = z.strictObject({
  steps: z.array(ScenarioStep).max(1000),
  report: z.string().max(20_000),
  exitCode: z.int().min(0).max(255).default(0),
  /** Keep running after the last step, until killed (to exercise timeouts). */
  hang: z.boolean().default(false),
  /** Multiplies every delay: 0.2 plays five times faster (the demo), 0 plays instantly (tests). */
  timeScale: z.number().nonnegative().max(100).default(1),
});
export type Scenario = z.infer<typeof Scenario>;
export type ScenarioInput = z.input<typeof Scenario>;
