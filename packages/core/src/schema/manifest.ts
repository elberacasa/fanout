import { z } from "zod";
import { SeatId } from "./common.ts";

/*
 * What an adapter declares about its CLI, as data rather than code: the versions it was verified against, the exact
 * non-interactive invocation, how to read its output, the safest modes it offers, how to ask it whether it is signed
 * in, and when its vendor's terms were last reviewed.
 *
 * A manifest is a promise we can check. A CLI outside `supportedVersions` is reported as an unsupported version
 * rather than driven on a guess, because a stream we have not seen is a stream we cannot parse honestly.
 */

/** A placeholder the supervisor fills in: {workdir}, {prompt}, {report}, {sandbox}, {model}, {effort}, {session}. */
const ArgTemplate = z.string().min(1).max(500);

export const AdapterManifest = z.strictObject({
  id: SeatId,
  displayName: z.string().min(1).max(80),
  binary: z.string().min(1).max(200),
  /** A semver range, e.g. ">=0.150 <1.0". Outside it, the seat is unsupported, never guessed at. */
  supportedVersions: z.string().min(1).max(100),
  /** What we promise about this seat, never a judgment of the CLI's quality. */
  tier: z.enum(["supported", "community", "reference"]),

  /** Null means no such mode or none verified: the merge gate must never act on a guess. */
  capabilities: z.strictObject({
    resume: z.strictObject({ args: z.array(ArgTemplate).min(1).max(50) }).nullable(),
    fork: z.strictObject({ args: z.array(ArgTemplate).min(1).max(50) }).nullable(),
    review: z.strictObject({ args: z.array(ArgTemplate).min(1).max(50) }).nullable(),
    /**
     * An allowlist keeps account identity out of storage. A privacy promise that is data can be reviewed in a pull
     * request; a promise in adapter code has to be re-read every time.
     */
    plan: z
      .strictObject({
        probe: z.array(z.string().min(1).max(100)).min(1).max(10),
        format: z.literal("json"),
        keep: z.array(z.string().min(1).max(100)).min(1).max(5),
        planField: z.string().min(1).max(100),
      })
      .refine((plan) => plan.keep.includes(plan.planField), {
        message: "planField must be one of keep",
        path: ["planField"],
      })
      .nullable(),
  }),

  headless: z.strictObject({
    args: z.array(ArgTemplate).min(1).max(50),
    /** Always closed: a CLI waiting on stdin is the most common way a run hangs forever. */
    stdin: z.literal("closed"),
  }),

  stream: z.strictObject({
    /** The flag that turns on machine-readable output, or null when the CLI has none. */
    flag: z.string().max(100).nullable(),
    format: z.enum(["jsonl", "text"]),
  }),

  models: z.array(z.string().min(1).max(100)).max(100),
  efforts: z.array(z.string().min(1).max(40)).max(20),

  /** The flag value for each mode we use. Auditors get the read-only one; nothing else is ever passed. */
  permissionModes: z.strictObject({
    readOnly: z.string().min(1).max(100),
    edit: z.string().min(1).max(100),
  }),

  network: z.strictObject({
    canDisable: z.boolean(),
    flag: z.string().max(100).nullable(),
  }),

  /** How to ask the CLI itself whether it is signed in. We never read credential files. */
  signIn: z.strictObject({
    probe: z.array(z.string().min(1).max(100)).max(10).nullable(),
    /** A pattern the probe's output must match to count as signed in. */
    okPattern: z.string().max(200).nullable(),
  }),

  /** Real usage when the CLI reports it; otherwise we estimate and say so. */
  usage: z.strictObject({
    probe: z.array(z.string().min(1).max(100)).max(10).nullable(),
    window: z.string().max(100),
  }),

  /** Which pool this seat's headless use bills against, so a vendor's policy change is a manifest change. */
  billing: z.enum(["subscription", "credit", "api", "unknown"]),

  terms: z.strictObject({
    reviewedAt: z.iso.date().nullable(),
    notes: z.string().max(2000),
  }),

  status: z.enum(["planned", "research", "alpha", "stable"]),
});
export type AdapterManifest = z.infer<typeof AdapterManifest>;
