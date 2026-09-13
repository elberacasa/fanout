import type { AdapterManifest, FanoutEventInput, SeatRef } from "fanout-core";
import { isolateWork } from "./isolate.ts";
import { CLEAN_REVISION, workSnapshot, type WorkSnapshot } from "./revision.ts";
import { runSeat, type SeatExecute } from "./run-seat.ts";

/*
 * Asking a cold reader to falsify what the lead believes.
 *
 * The lead carries the plan, the reasoning and the justification for every line it wrote, and that context is
 * exactly what hides its mistakes from it: knowing why the code is right makes the code look right. A reader with
 * only the diff is not smarter, it is differently placed. Broad review pays for that asymmetry by the token;
 * three specific claims get it for almost nothing.
 *
 * Every rule here bends one way. A verdict we cannot read is `unclear`, a claim the reader skipped is `unclear`,
 * and a reader that never ran refutes nothing and confirms nothing. Confirmation has to be said out loud, because
 * the whole value of this is that it cannot be satisfied by silence.
 */

export type Verdict = "confirmed" | "refuted" | "unclear";

export interface CheckedClaim {
  claim: string;
  verdict: Verdict;
  evidence: string;
}

export interface ClaimsOptions {
  repoRoot: string;
  claims: readonly string[];
  manifest: AdapterManifest;
  model?: string;
  timeoutMs?: number;
  execute?: SeatExecute;
}

export interface ClaimsResult {
  event: Extract<FanoutEventInput, { type: "claims.checked" }>;
  /** Claims the reader actively refuted. The only reason to stop and look. */
  refuted: CheckedClaim[];
}

/** The verdict line we ask for, and the only one we will read as an answer. */
const VERDICT_LINE = /^\s*CLAIM\s+(\d+)\s*:\s*(CONFIRMED|REFUTED|UNCLEAR)\b\s*[-—:]?\s*(.*)$/i;

export async function checkClaims(options: ClaimsOptions): Promise<ClaimsResult> {
  /*
   * A session started outside a repository is an ordinary thing, not an exception. Throwing here would make the
   * tool look broken to whoever called it; answering "there is nothing here to check" is both true and useful.
   */
  let snapshot: WorkSnapshot;
  try {
    snapshot = await workSnapshot({ cwd: options.repoRoot });
  } catch {
    return {
      event: {
        type: "claims.checked",
        repoRoot: options.repoRoot,
        revision: CLEAN_REVISION,
        by: { id: options.manifest.id },
        claims: options.claims.map((claim) =>
          unclear(claim, `${options.repoRoot} is not a git repository, so there are no changes to check`),
        ),
        ran: false,
      },
      refuted: [],
    };
  }
  const by: SeatRef = {
    id: options.manifest.id,
    ...(options.model === undefined ? {} : { model: options.model }),
  };

  const base = {
    type: "claims.checked" as const,
    repoRoot: snapshot.repoRoot,
    revision: snapshot.revision,
    by,
  };

  /*
   * Only uncommitted work, and the message has to say so. This reads what is in the tree right now because the
   * point is to catch a belief before it lands — the reader gets the diff and nothing else, which is what makes
   * it differently placed. Saying merely "no changes" reads as "nothing is wrong" to whoever asked, when the
   * truth is that nothing was looked at: the two are opposite answers and the caller cannot tell them apart.
   */
  if (snapshot.clean) {
    return {
      event: {
        ...base,
        claims: options.claims.map((c) =>
          unclear(
            c,
            "the working tree is clean, and this checks uncommitted work only — nothing was read, which is " +
              "not the same as nothing being wrong. State your claims before you commit.",
          ),
        ),
        ran: false,
      },
      refuted: [],
    };
  }

  const isolated = await isolateWork({
    repoRoot: snapshot.repoRoot,
    newFiles: snapshot.newFiles,
    ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
  });

  try {
    const result = await runSeat({
      manifest: options.manifest,
      cwd: isolated.path,
      prompt: promptFor(options.claims),
      ...(options.model === undefined ? {} : { model: options.model }),
      ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
      ...(options.execute === undefined ? {} : { execute: options.execute }),
    });

    if (!result.ok) {
      /*
       * The reason travels with the verdict. An earlier version returned a flat "not checked" here, which is true
       * and useless: it told the owner nothing and told me nothing when this failed on its first real run.
       */
      return {
        event: {
          ...base,
          claims: options.claims.map((claim) => unclear(claim, result.problem)),
          ran: false,
        },
        refuted: [],
      };
    }

    const claims = readVerdicts(options.claims, result.text);
    return { event: { ...base, claims, ran: true }, refuted: claims.filter((c) => c.verdict === "refuted") };
  } finally {
    await isolated.dispose();
  }
}

/**
 * What we ask the reader.
 *
 * It is told to try to falsify, not to agree, and told that saying "I cannot tell" is a real answer. A reader
 * nudged toward confirmation will confirm, which would make every run of this worthless and expensive at once.
 */
function promptFor(claims: readonly string[]): string {
  const numbered = claims.map((claim, index) => `${String(index + 1)}. ${claim}`).join("\n");
  return [
    "You are reading a diff you did not write, with no knowledge of why it was written.",
    "Below are claims its author makes about it. Your job is to try to FALSIFY each one by reading the code.",
    "",
    "Rules:",
    "- Answer every claim, in order, one line each, in exactly this format:",
    "  CLAIM <n>: CONFIRMED|REFUTED|UNCLEAR - <one sentence of evidence, naming a file and line where you can>",
    "- REFUTED means you found a concrete case where the claim does not hold. Name it.",
    "- UNCLEAR is a real answer. Use it when the diff does not let you tell. Do not guess, and do not",
    "  confirm something you merely failed to disprove.",
    "- CONFIRMED means you actively checked and it holds.",
    "- Say nothing else before or after the CLAIM lines.",
    "",
    "Claims:",
    numbered,
  ].join("\n");
}

/**
 * Reads the reader's verdicts, and refuses to invent any it did not give.
 *
 * A missing line, an unparsable line, or a line for a claim that does not exist all leave that claim `unclear`.
 * The failure mode this protects against is the one that matters: a checker that quietly reports everything fine
 * whenever the output format drifts is worse than no checker, because it is trusted.
 */
export function readVerdicts(claims: readonly string[], text: string): CheckedClaim[] {
  const found = new Map<number, { verdict: Verdict; evidence: string }>();

  for (const line of text.split("\n")) {
    const match = VERDICT_LINE.exec(line);
    if (match === null) continue;
    const index = Number(match[1]) - 1;
    const word = (match[2] ?? "").toLowerCase();
    if (index < 0 || index >= claims.length) continue;
    if (word !== "confirmed" && word !== "refuted" && word !== "unclear") continue;
    // First answer wins: a reader that contradicts itself later has not confirmed anything.
    if (!found.has(index)) found.set(index, { verdict: word, evidence: (match[3] ?? "").trim() });
  }

  return claims.map((claim, index) => {
    const answer = found.get(index);
    if (answer === undefined) return unclear(claim, "the reader did not answer this claim");
    // A refusal with no reason is not actionable, but it is still a refusal — we keep it and say the reason is missing.
    return {
      claim,
      verdict: answer.verdict,
      evidence: answer.evidence === "" ? "(no reason given)" : answer.evidence,
    };
  });
}

function unclear(claim: string, evidence: string): CheckedClaim {
  return { claim, verdict: "unclear", evidence };
}
