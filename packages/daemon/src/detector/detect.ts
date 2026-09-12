import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { SeatInfo, type AdapterManifest } from "@fanout/core";
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
  const timeoutMs = options.timeoutMs ?? 10_000;
  const execute = options.execute ?? defaultExecute(timeoutMs);
  // Every probe gets its own deadline, and so does the seat as a whole: a CLI can hang between probes as easily
  // as during one, and `execFile`'s own timeout does not exist at all when a caller injects an executor.
  const bounded = (binary: string, args: readonly string[]): Promise<CommandResult> =>
    within(execute(binary, args), timeoutMs, null).then((result) => result ?? NO_ANSWER);

  return Promise.all(
    options.manifests.map(async (manifest) =>
      // Detection is the first thing a session does, so it must always finish. One CLI that never answers must
      // not hide the seats that did: an unfinished probe becomes "unknown" for that seat and nothing more.
      within(detectSeat(manifest, bounded), timeoutMs * 3, unknownSeat(manifest)),
    ),
  );
}

/** What a probe that never answered "said". Not an error: we simply do not know, which is a valid answer here. */
const NO_ANSWER: CommandResult = { stdout: "", stderr: "", exitCode: -1 };

/**
 * Resolves with `whenLate` if `work` has not settled in time.
 *
 * A promise cannot be cancelled, so this stops *waiting*; it does not stop the work. That is the honest
 * description and also the safe one: for the real executor the child already carries its own kill timeout, and
 * for an injected one there is nothing to kill. The timer is unref'd so a straggler cannot hold the process open.
 */
function within<T>(work: Promise<T>, ms: number, whenLate: T): Promise<T> {
  return new Promise<T>((resolve) => {
    const timer = setTimeout(() => {
      resolve(whenLate);
    }, ms);
    timer.unref();
    work.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      () => {
        clearTimeout(timer);
        resolve(whenLate);
      },
    );
  });
}

function unknownSeat(manifest: AdapterManifest): SeatInfo {
  return {
    id: manifest.id,
    displayName: manifest.displayName,
    binary: manifest.binary,
    models: manifest.models,
    efforts: manifest.efforts,
    billing: manifest.billing,
    version: null,
    supported: false,
    signedIn: "unknown",
    plan: null,
  };
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

  const kept = keepAllowed(parsed, plan.keep);

  // A tier belongs to an account, so a signed-out answer carries no current plan — only, at best, the last one
  // this machine happened to see. `loggedIn` is on the allowlist precisely so this question can be asked.
  if (Object.hasOwn(kept, "loggedIn") && kept["loggedIn"] !== true) return null;

  const name = kept[plan.planField];
  // A CLI that answers in a shape we did not expect has told us nothing, and a guess here would be recorded as a
  // fact and routed on. The schema has the final say, so detection cannot return a seat it could not itself store.
  const candidate = typeof name === "string" ? { name, source: "detected" as const } : null;
  const checked = SeatInfo.shape.plan.safeParse(candidate);
  return checked.success ? checked.data : null;
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
  const { probe, okPattern, noPattern } = manifest.signIn;
  if (probe === null) return "unknown";

  const result = await attempt(() => execute(manifest.binary, probe));
  if (result === null) return "unknown";

  const answer = `${result.stdout}\n${result.stderr}`;
  // Signed out is checked first and on its own terms. "Not logged in" contains "Logged in", so a positive
  // pattern asked first will happily read a refusal as an approval — which is exactly what this code used to do.
  if (noPattern !== null && matches(noPattern, answer)) return "no";
  if (okPattern !== null && matches(okPattern, answer)) return "yes";

  // Neither shape. A non-zero exit with nothing we recognise is a failure to answer, not an answer of "no":
  // reporting "no" would route someone's work away from a seat that may be perfectly fine.
  return "unknown";
}

/**
 * Runs a manifest's pattern against a bounded prefix of the CLI's output.
 *
 * The bound is the point. A pattern is compiled when the manifest is parsed, so it is valid, but validity says
 * nothing about cost: `^(a+)+$` against a long line backtracks for effectively ever, and a regular expression is
 * synchronous, so no timeout anywhere else in this file can interrupt it. Sign-in answers are short; anything
 * past a couple of kilobytes is not the answer we are looking for.
 */
function matches(pattern: string, text: string): boolean {
  return new RegExp(pattern, "i").test(text.slice(0, 2_000));
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
