import type { AdapterManifest, FanoutEventInput, SeatRef } from "fanout-core";
import { isolateWork } from "./isolate.ts";
import { runCliOnce } from "./run-seat.ts";
import { workSnapshot, type WorkSnapshot } from "./revision.ts";

/*
 * A second vendor, reading the lead's own uncommitted work.
 *
 * This is the part of Fanout that earns its place in a session where no agent ran at all. Most of the code in a
 * Claude Code session is written by the lead, and the lead is the one reviewer it gets — which is exactly how a
 * confident mistake ships. Pointing another vendor's own review command at the working tree costs one call and
 * breaks that loop, because a different model does not share the author's blind spots.
 *
 * It reads, and it reads a copy. A read-only sandbox stops a reviewer writing, not reading, so a reviewer
 * launched in the repository could open `.env` or a private key that happens to be lying there — which is why the
 * work is rebuilt in a throwaway worktree first, where ignored files simply do not exist. Its answer is recorded
 * verbatim rather than summarised by the author it is about.
 */

export interface BuddyOptions {
  repoRoot: string;
  /** The seat doing the reading. Must declare a `review` capability; nothing is guessed if it does not. */
  manifest: AdapterManifest;
  model?: string;
  timeoutMs?: number;
  /** Injected in tests so nothing needs a CLI installed. */
  execute?: (
    binary: string,
    args: readonly string[],
    options: { cwd: string; timeoutMs: number },
  ) => Promise<{ stdout: string; stderr: string; exitCode: number }>;
}

export interface BuddyResult {
  snapshot: WorkSnapshot;
  /** The event to record. Always produced, including when the reviewer could not run. */
  event: Extract<FanoutEventInput, { type: "buddy.reviewed" }>;
}

export class BuddyUnavailable extends Error {
  readonly seat: string;

  constructor(seat: string, reason: string) {
    super(`${seat} cannot review: ${reason}`);
    this.name = "BuddyUnavailable";
    this.seat = seat;
  }
}

/** Asks the seat to review whatever is currently uncommitted, and returns what it said. */
export async function buddyReview(options: BuddyOptions): Promise<BuddyResult> {
  const { manifest } = options;
  const review = manifest.capabilities.review;
  if (review === null) {
    throw new BuddyUnavailable(manifest.id, "its CLI has no non-interactive review command");
  }

  const snapshot = await workSnapshot({ cwd: options.repoRoot });
  const by: SeatRef = { id: manifest.id, ...(options.model === undefined ? {} : { model: options.model }) };

  const base = {
    type: "buddy.reviewed" as const,
    repoRoot: options.repoRoot,
    revision: snapshot.revision,
    by,
    files: snapshot.files,
  };

  // Nothing to read is not a finding, and asking anyway would spend a subscription to be told so.
  if (snapshot.clean) {
    return { snapshot, event: { ...base, findings: "", ran: true } };
  }

  const isolated = await isolateWork({
    repoRoot: snapshot.repoRoot,
    newFiles: snapshot.newFiles,
    ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
  });

  /*
   * Building the copy takes a moment, and an editor saving in that moment would leave us reviewing one set of
   * bytes while recording the revision of another — a review that certifies work nobody read. Cheaper to look
   * again than to reason about the window: if the work moved, say so and let the caller ask again.
   */
  const after = await workSnapshot({ cwd: snapshot.repoRoot });
  if (after.revision !== snapshot.revision) {
    await isolated.dispose();
    return {
      snapshot: after,
      event: {
        ...base,
        revision: after.revision,
        files: after.files,
        findings: "your files changed while the review copy was being made; nothing was reviewed",
        ran: false,
      },
    };
  }

  const args = fill(review.args, {
    "{workdir}": isolated.path,
    // A reviewer reads; it is given the read-only mode its own manifest names, never the editing one.
    "{sandbox}": manifest.permissionModes.readOnly,
    ...(options.model === undefined ? {} : { "{model}": options.model }),
  });

  const execute = options.execute ?? runCliOnce;
  let stdout: string;
  try {
    const result = await execute(manifest.binary, args, {
      cwd: isolated.path,
      timeoutMs: options.timeoutMs ?? 10 * 60_000,
    });
    if (result.exitCode !== 0) {
      /*
       * A reviewer that failed has not approved anything. Recording `ran: false` with the reason keeps "we asked
       * and it broke" distinguishable from "it found nothing" — which would otherwise read as a clean bill.
       */
      return {
        snapshot,
        event: { ...base, findings: firstLines(result.stderr || result.stdout), ran: false },
      };
    }
    stdout = result.stdout;
  } catch (cause) {
    return { snapshot, event: { ...base, findings: describe(cause), ran: false } };
  } finally {
    await isolated.dispose();
  }

  const findings = findingsFrom(stdout, isolated.path);
  const refused = isolated.refused;
  /*
   * An exit code of zero is not a review. A CLI that printed nothing we recognise has not told us the code is
   * fine, and recording that as a completed review with no findings would turn silence into a clean bill of
   * health — the exact shape of dishonesty this project refuses.
   */
  if (findings === null) {
    return {
      snapshot,
      event: { ...base, findings: "the reviewer exited cleanly but said nothing we could read", ran: false },
    };
  }

  /*
   * A file kept out of the copy is said out loud. A reviewer that never saw a file has not approved it, and a
   * silent omission is the difference between "reviewed" and "reviewed most of it".
   */
  const note =
    refused.length === 0
      ? ""
      : `\n\nNot shown to the reviewer: ${refused.map((item) => `${item.path} (${item.reason})`).join(", ")}`;

  return { snapshot, event: { ...base, findings: `${findings}${note}`, ran: true } };
}

/**
 * The reviewer's own words, pulled out of its stream.
 *
 * Codex reports a review as prose inside an `agent_message`, with a `- [P1] title — path:lines` convention and no
 * severity or file field to read (verified 2026-09-12). So this deliberately does not parse findings into
 * structure: inventing a schema over a convention would produce confident, wrong severities the moment the
 * convention shifts. The lead reads the prose, which is what a second opinion is for.
 *
 * Returns null when the stream held no reviewer message at all, which is a different thing from a review with
 * nothing to say and must never be reported as one.
 */
function findingsFrom(stream: string, repoRoot: string): string | null {
  const messages: string[] = [];
  for (const line of stream.split("\n")) {
    if (line.trim() === "") continue;
    try {
      const parsed: unknown = JSON.parse(line);
      const item = (parsed as { item?: { type?: string; text?: string } }).item;
      if (item?.type === "agent_message" && typeof item.text === "string") messages.push(item.text);
    } catch {
      // An unparsable line is the CLI talking to a human, not to us; the findings are in the parsed ones.
    }
  }
  if (messages.length === 0) return null;
  // Reviewers report absolute paths — here, paths inside the throwaway copy. Making them repo-relative is the
  // difference between a clickable finding and a line naming a directory that no longer exists.
  return messages.join("\n\n").split(`${repoRoot}/`).join("");
}

/**
 * Fills a manifest's argument template, dropping any placeholder nobody supplied — and the flag in front of it.
 *
 * Found by running this for real: with no model chosen, `["-m", "{model}"]` became `["-m", ""]`, and Codex
 * answered `The '' model is not supported`. An unsupplied option must vanish, not become an empty string, because
 * an empty string is a value and CLIs are entitled to reject it.
 */
function fill(template: readonly string[], values: Readonly<Record<string, string>>): string[] {
  const filled: string[] = [];
  for (const argument of template) {
    const placeholder = /^\{[a-z]+\}$/.test(argument) ? argument : null;
    if (placeholder !== null && !Object.hasOwn(values, placeholder)) {
      // Drop the flag this value belonged to, so `-m` does not survive without its model.
      if (filled[filled.length - 1]?.startsWith("-") === true) filled.pop();
      continue;
    }
    filled.push(
      Object.entries(values).reduce((text, [name, value]) => text.split(name).join(value), argument),
    );
  }
  return filled;
}

function firstLines(text: string, count = 5): string {
  return text.split("\n").slice(0, count).join("\n").trim();
}

function describe(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}
