import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { mergeReadiness, type PlanLine, type RunView } from "@fanout/core";
import { git, lines, zeroSeparated } from "../workspace/git.ts";

/*
 * Putting a run's work into the repository, and refusing to in every other case.
 *
 * This is the most dangerous function in the product: everything else can be wrong and leave your code alone.
 * So it asks permission from a pure judgement it cannot influence (`mergeReadiness`, over recorded facts), it
 * applies with a three-way merge so a conflict is a conflict rather than a silent overwrite, and it never forces
 * anything. A conflict is reported and the repository is left exactly as it was found.
 *
 * It also refuses to merge a diff that is not the one everybody looked at. Review, checks, proof and approval each
 * recorded the revision they judged; if the worktree has moved since, all four were about a different piece of
 * work and none of them is evidence about this one.
 */

export interface MergeOptions {
  repoRoot: string;
  /** The worktree holding the agent's changes. */
  workspacePath: string;
  run: RunView;
  line: PlanLine;
  /** What the work is right now, freshly collected — not what anyone remembers it being. */
  revision: string;
  patch: string;
  /** Files the run created, which a patch does not carry. */
  newFiles: readonly string[];
  /**
   * The commit's subject and body, written by the lead.
   *
   * Every project has its own convention and some enforce it with a hook; ours rejected the gate's own first
   * attempt. Guessing a format is not possible and bypassing the hook is out of the question — a tool that
   * merged past the rules a repository set for itself would be the least trustworthy thing here. So the lead,
   * which can read the repository's standard, supplies this. The trailers below it are the gate's and are not
   * the caller's to write.
   */
  message?: string;
  timeoutMs?: number;
}

export type MergeOutcome =
  | { kind: "merged"; files: string[]; commit: string }
  | { kind: "conflict"; files: string[]; why: string }
  | { kind: "refused"; why: string[] };

/**
 * Merges a run's work, or explains why it will not.
 *
 * Nothing is committed unless every file applied. A partial merge is the worst outcome available here — half a
 * change in your working tree, with the other half in a report — so a conflict rolls the whole attempt back.
 */
export async function mergeRun(options: MergeOptions): Promise<MergeOutcome> {
  const readiness = mergeReadiness(options.run, options.line, options.revision);
  if (!readiness.ready) {
    return { kind: "refused", why: readiness.blockers.map((blocker) => blocker.message) };
  }

  const inRepo = {
    cwd: options.repoRoot,
    ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
  };

  /*
   * A dirty repository is refused rather than merged into. The three-way apply would probably work, and
   * "probably" is not a word that belongs anywhere near someone else's uncommitted work.
   */
  const dirty = zeroSeparated(await git(["status", "--porcelain", "-z"], inRepo))
    .map((entry) => entry.slice(3))
    .filter((path) => path !== "");
  const wouldTouch = new Set([...filesInPatch(options.patch), ...options.newFiles]);
  const clash = dirty.filter((path) => wouldTouch.has(path)).sort();
  if (clash.length > 0) {
    return {
      kind: "refused",
      why: [
        `You have uncommitted changes in ${clash.join(", ")}, which this merge would touch. ` +
          "Commit or stash them first.",
      ],
    };
  }

  const before = (await git(["rev-parse", "HEAD"], inRepo)).trim();
  const applied: string[] = [];

  try {
    if (options.patch.trim() !== "") {
      /*
       * `-3` so git can use the blobs both sides came from: it turns "this hunk does not apply" into a real
       * three-way merge, and into honest conflict markers when the two changes genuinely disagree.
       */
      await applyPatch(options.patch, options.repoRoot, options.timeoutMs);
      applied.push(...filesInPatch(options.patch));
    }

    for (const file of options.newFiles) {
      const destination = join(options.repoRoot, file);
      // A "new" file that already exists is not new: someone else created it while this run was working.
      if (existsSync(destination)) {
        await rollback(options.repoRoot, before, options.timeoutMs);
        return {
          kind: "conflict",
          files: [file],
          why: `${file} was created here while the run was working, so this would overwrite it`,
        };
      }
      mkdirSync(dirname(destination), { recursive: true });
      copyFileSync(join(options.workspacePath, file), destination);
      applied.push(file);
    }
  } catch (cause) {
    const conflicted = await conflictedFiles(options.repoRoot, options.timeoutMs);
    await rollback(options.repoRoot, before, options.timeoutMs);
    return {
      kind: "conflict",
      files: conflicted.length > 0 ? conflicted : [...wouldTouch].sort(),
      why: conflicted.length > 0 ? "the work disagrees with what is here now" : describe(cause),
    };
  }

  const files = [...new Set(applied)].sort();
  try {
    await git(["add", "--", ...files], inRepo);
    await git(
      [
        "commit",
        "--quiet",
        "-m",
        commitMessage(options),
        "--author",
        `${options.run.seat.id} via fanout <noreply@fanout.invalid>`,
        "--",
        ...files,
      ],
      inRepo,
    );
  } catch (cause) {
    /*
     * A repository may refuse its own commit — ours does, through a commit-msg hook, and said so the first time
     * the gate tried. Rolling back here is the difference between "not merged" and the thing this function
     * promises never to leave behind: the work applied, staged, and uncommitted, with the report saying it
     * failed. `--no-verify` is never the answer; a tool that merged past the rules a repository set for itself
     * would be the least trustworthy thing in it.
     */
    await rollback(options.repoRoot, before, options.timeoutMs);
    return {
      kind: "refused",
      why: [`The repository refused the commit, and nothing was changed: ${describe(cause)}`],
    };
  }

  const commit = (await git(["rev-parse", "HEAD"], inRepo)).trim();
  return { kind: "merged", files, commit };
}

/**
 * Who wrote this, in the history itself.
 *
 * The author is the seat, because it wrote the code, and the trailer names the person or policy that approved it,
 * because someone authorised it. A repository whose history cannot answer "who decided this" is a repository
 * where nobody decided.
 */
function commitMessage(options: MergeOptions): string {
  const { line, run } = options;
  const approval = run.approval;
  const by =
    approval === null
      ? "unknown"
      : approval.by.kind === "user"
        ? "the repository's owner"
        : `policy "${approval.by.name}"`;
  return [
    options.message ?? `${line.title} (${line.id})\n\n${line.prompt.split("\n")[0] ?? ""}`,
    "",
    `Built-by: ${run.seat.id}${run.seat.model === undefined ? "" : ` (${run.seat.model})`} via fanout`,
    `Approved-by: ${by}`,
    `Fanout-run: ${run.runId}`,
  ].join("\n");
}

/** Every path a patch claims to change, read from the patch rather than from anyone's account of it. */
export function filesInPatch(patch: string): string[] {
  const paths = new Set<string>();
  for (const line of patch.split("\n")) {
    const match = /^\+\+\+ b\/(.+)$/.exec(line);
    if (match?.[1] !== undefined && match[1] !== "/dev/null") paths.add(match[1]);
  }
  return [...paths].sort();
}

async function applyPatch(patch: string, cwd: string, timeoutMs?: number): Promise<void> {
  const { execFile } = await import("node:child_process");
  const { gitEnv } = await import("../workspace/git.ts");
  const failure = await new Promise<Error | null>((resolve) => {
    const child = execFile(
      "git",
      ["apply", "-3", "--whitespace=nowarn", "-"],
      { cwd, timeout: timeoutMs ?? 60_000, env: gitEnv() },
      (error) => {
        resolve(error);
      },
    );
    child.stdin?.end(patch);
  });
  if (failure !== null) throw failure;
}

async function conflictedFiles(repoRoot: string, timeoutMs?: number): Promise<string[]> {
  try {
    return lines(
      await git(["diff", "--name-only", "--diff-filter=U"], {
        cwd: repoRoot,
        ...(timeoutMs === undefined ? {} : { timeoutMs }),
      }),
    );
  } catch {
    return [];
  }
}

/** Back to exactly where we started. A half-applied merge is worse than a refused one. */
async function rollback(repoRoot: string, commit: string, timeoutMs?: number): Promise<void> {
  const inRepo = { cwd: repoRoot, ...(timeoutMs === undefined ? {} : { timeoutMs }) };
  await git(["reset", "--hard", "--quiet", commit], inRepo).catch(() => undefined);
  await git(["clean", "-fdq"], inRepo).catch(() => undefined);
}

function describe(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}
