import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { AdapterManifest, SeatInfo } from "@fanout/core";
import { baseEnv } from "../env.ts";
import { parseVersion, satisfies } from "./version.ts";

/*
 * Who is on the crew. For each adapter we ask the CLI itself three things: are you here, which version are you, and
 * are you signed in — the last one through the CLI's own status command. We never read a credential file, never
 * parse a token, and never guess: a CLI we cannot find, cannot read a version from, or whose version is outside the
 * range its adapter was verified against is reported as unsupported, and one that cannot tell us its sign-in state
 * says "unknown" rather than "yes".
 */

const run = promisify(execFile);

export interface CommandResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export interface DetectOptions {
  manifests: readonly AdapterManifest[];
  /** Runs a CLI. Injected in tests so detection needs no CLIs installed. */
  execute?: (binary: string, args: readonly string[]) => Promise<CommandResult>;
  /** How long any single probe may take before it counts as not answering. */
  timeoutMs?: number;
}

export async function detectSeats(options: DetectOptions): Promise<SeatInfo[]> {
  const execute = options.execute ?? defaultExecute(options.timeoutMs ?? 10_000);

  return Promise.all(options.manifests.map((manifest) => detectSeat(manifest, execute)));
}

async function detectSeat(
  manifest: AdapterManifest,
  execute: (binary: string, args: readonly string[]) => Promise<CommandResult>,
): Promise<SeatInfo> {
  const base = {
    id: manifest.id,
    displayName: manifest.displayName,
    binary: manifest.binary,
    models: manifest.models,
    efforts: manifest.efforts,
    billing: manifest.billing,
  };

  const versionResult = await attempt(() => execute(manifest.binary, ["--version"]));
  if (versionResult?.exitCode !== 0) {
    return { ...base, version: null, supported: false, signedIn: "unknown", plan: null };
  }

  const version = parseVersion(`${versionResult.stdout} ${versionResult.stderr}`);
  if (version === null) {
    return { ...base, version: null, supported: false, signedIn: "unknown", plan: null };
  }

  const printed = `${version.major}.${version.minor}.${version.patch}`;
  const supported = satisfies(version, manifest.supportedVersions);
  if (!supported) {
    // A stream we have not seen is a stream we cannot parse honestly, so we stop at the version — and in
    // particular we do not send an unverified build a probe whose answer we would not know how to read.
    return { ...base, version: printed, supported: false, signedIn: "unknown", plan: null };
  }

  const [signedIn, plan] = await Promise.all([signInState(manifest, execute), planState(manifest, execute)]);
  return { ...base, version: printed, supported: true, signedIn, plan };
}

/**
 * Keep only the fields the manifest allows, and drop everything else before it can travel any further.
 *
 * This is the whole of the privacy control, and it is deliberately four lines in one place. The probe that reports
 * Claude's subscription tier answers with the user's email address and organisation id in the same object; those
 * must never reach the ledger, a log, a projection or a prompt. Filtering at the moment of reading — rather than
 * remembering not to use the extra fields later — is what makes that a property of the code instead of a habit.
 */
function keepAllowed(parsed: Record<string, unknown>, keep: readonly string[]): Record<string, unknown> {
  return Object.fromEntries(
    keep.filter((field) => Object.hasOwn(parsed, field)).map((field) => [field, parsed[field]]),
  );
}

async function planState(
  manifest: AdapterManifest,
  execute: (binary: string, args: readonly string[]) => Promise<CommandResult>,
): Promise<SeatInfo["plan"]> {
  const { plan } = manifest.capabilities;
  if (plan === null) return null;

  const result = await attempt(() => execute(manifest.binary, plan.probe));
  if (result?.exitCode !== 0) return null;

  const parsed = parseJsonObject(result.stdout);
  if (parsed === null) return null;

  const name = keepAllowed(parsed, plan.keep)[plan.planField];
  // A CLI that answers in a shape we did not expect has told us nothing, and a guess here would be recorded as a
  // fact and routed on.
  if (typeof name !== "string" || name === "") return null;

  return { name, source: "detected" };
}

function parseJsonObject(text: string): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(text);
    return typeof value === "object" && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

async function signInState(
  manifest: AdapterManifest,
  execute: (binary: string, args: readonly string[]) => Promise<CommandResult>,
): Promise<SeatInfo["signedIn"]> {
  const { probe, okPattern } = manifest.signIn;
  if (probe === null || okPattern === null) return "unknown";

  const result = await attempt(() => execute(manifest.binary, probe));
  if (result === null) return "unknown";
  if (result.exitCode !== 0) return "no";

  return new RegExp(okPattern, "i").test(`${result.stdout}\n${result.stderr}`) ? "yes" : "no";
}

/** A probe that throws, hangs or cannot start tells us nothing; it must never take the daemon down with it. */
async function attempt(work: () => Promise<CommandResult>): Promise<CommandResult | null> {
  try {
    return await work();
  } catch {
    return null;
  }
}

function defaultExecute(timeoutMs: number) {
  return async (binary: string, args: readonly string[]): Promise<CommandResult> => {
    try {
      const { stdout, stderr } = await run(binary, [...args], {
        timeout: timeoutMs,
        env: baseEnv(),
        windowsHide: true,
      });
      return { stdout, stderr, exitCode: 0 };
    } catch (cause) {
      const detail = cause as { stdout?: string; stderr?: string; code?: number };
      // A CLI that answers "not signed in" with a non-zero exit is answering, not failing.
      if (typeof detail.code === "number") {
        return { stdout: detail.stdout ?? "", stderr: detail.stderr ?? "", exitCode: detail.code };
      }
      throw cause;
    }
  };
}
