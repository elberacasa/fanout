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
    return { ...base, version: null, supported: false, signedIn: "unknown" };
  }

  const version = parseVersion(`${versionResult.stdout} ${versionResult.stderr}`);
  if (version === null) {
    return { ...base, version: null, supported: false, signedIn: "unknown" };
  }

  const printed = `${version.major}.${version.minor}.${version.patch}`;
  const supported = satisfies(version, manifest.supportedVersions);
  if (!supported) {
    // A stream we have not seen is a stream we cannot parse honestly, so we stop at the version.
    return { ...base, version: printed, supported: false, signedIn: "unknown" };
  }

  return { ...base, version: printed, supported: true, signedIn: await signInState(manifest, execute) };
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
