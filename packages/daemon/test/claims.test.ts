import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { AdapterManifest } from "@fanout/core";
import { describe, expect, it } from "vitest";
import { checkClaims, readVerdicts } from "../src/gate/claims.ts";
import { agentText, fillTemplate } from "../src/gate/run-seat.ts";

/*
 * Reading a cold reader's verdicts. Every rule here bends one way: confirmation must be said out loud, and
 * anything we cannot read is unclear. A checker that quietly reports "all fine" whenever the output format drifts
 * is worse than no checker at all, because it is trusted.
 */

const CLAIMS = [
  "Reviewer cannot read ignored files",
  "No behaviour change outside gate/",
  "Covered by tests",
];

describe("reading verdicts", () => {
  it("reads a clean answer", () => {
    const answered = readVerdicts(
      CLAIMS,
      [
        "CLAIM 1: REFUTED - an untracked symlink dereferences to .env, isolate.ts:69",
        "CLAIM 2: CONFIRMED - nothing outside gate/ is touched",
        "CLAIM 3: UNCLEAR - the diff does not show the test files",
      ].join("\n"),
    );

    expect(answered.map((c) => c.verdict)).toEqual(["refuted", "confirmed", "unclear"]);
    expect(answered[0]?.evidence).toContain("symlink");
  });

  it.each([
    ["an em dash", "CLAIM 1: REFUTED — because"],
    ["a colon", "CLAIM 1: REFUTED: because"],
    ["lower case", "claim 1: refuted - because"],
    ["extra spacing", "  CLAIM   1 :  REFUTED   -  because"],
  ])("survives %s, because a real CLI will not match a regex exactly", (_label, line) => {
    expect(readVerdicts(CLAIMS, line)[0]?.verdict).toBe("refuted");
  });

  /*
   * The invariant. Everything below is a way the reader failed to answer, and not one of them may become a pass.
   */
  it.each([
    ["it said nothing", ""],
    ["it wrote prose instead", "Looks good to me overall, nothing concerning."],
    ["it answered a claim that does not exist", "CLAIM 9: CONFIRMED - fine"],
    ["it used a word we do not know", "CLAIM 1: PROBABLY - fine"],
    ["it numbered from zero", "CLAIM 0: CONFIRMED - fine"],
    ["the format drifted", "1. CONFIRMED — fine"],
  ])("leaves every claim unclear when %s", (_label, text) => {
    const answered = readVerdicts(CLAIMS, text);
    expect(answered.map((c) => c.verdict)).toEqual(["unclear", "unclear", "unclear"]);
  });

  it("does not let an answer to one claim stand for the others", () => {
    const answered = readVerdicts(CLAIMS, "CLAIM 2: CONFIRMED - checked");
    expect(answered.map((c) => c.verdict)).toEqual(["unclear", "confirmed", "unclear"]);
    expect(answered[0]?.evidence).toContain("did not answer");
  });

  it("keeps the first answer when the reader contradicts itself", () => {
    // A reader that says REFUTED then CONFIRMED has not confirmed anything.
    const answered = readVerdicts(CLAIMS, "CLAIM 1: REFUTED - found one\nCLAIM 1: CONFIRMED - never mind");
    expect(answered[0]?.verdict).toBe("refuted");
  });

  it("keeps a refusal that came with no reason, and says the reason is missing", () => {
    const answered = readVerdicts(CLAIMS, "CLAIM 1: REFUTED");
    expect(answered[0]).toMatchObject({ verdict: "refuted", evidence: "(no reason given)" });
  });
});

describe("reading what a seat said", () => {
  it("joins the agent's messages and ignores its machinery", () => {
    const stream = [
      JSON.stringify({ type: "thread.started", thread_id: "01a0" }),
      JSON.stringify({ type: "item.completed", item: { type: "command_execution" } }),
      JSON.stringify({
        type: "item.completed",
        item: { type: "agent_message", text: "CLAIM 1: CONFIRMED - ok" },
      }),
    ].join("\n");
    expect(agentText(stream)).toBe("CLAIM 1: CONFIRMED - ok");
  });

  it.each([
    ["nothing", ""],
    ["only machinery", JSON.stringify({ type: "turn.completed", usage: {} })],
    ["unparsable output", "Working...\nDone."],
  ])("says it heard %s rather than returning an empty answer", (_label, stream) => {
    expect(agentText(stream)).toBeNull();
  });
});

describe("filling a seat's arguments", () => {
  it("drops an option nobody supplied, along with its flag", () => {
    const args = fillTemplate(["exec", "-C", "{workdir}", "-m", "{model}", "{prompt}"], {
      "{workdir}": "/w",
      "{prompt}": "hello",
    });
    expect(args).toEqual(["exec", "-C", "/w", "hello"]);
  });

  it("keeps an option that was supplied", () => {
    const args = fillTemplate(["-m", "{model}"], { "{model}": "gpt-5.6-luna" });
    expect(args).toEqual(["-m", "gpt-5.6-luna"]);
  });

  it("does not mistake a literal argument for a placeholder", () => {
    expect(fillTemplate(["--json", "review"], {})).toEqual(["--json", "review"]);
  });
});

/*
 * A session started outside a repository is ordinary, not exceptional. Found by calling the MCP tool from a real
 * Claude Code session launched in /tmp: it threw, and a tool that throws looks broken rather than answering.
 */
describe("asking about a directory that is not a repository", () => {
  it("answers that there is nothing to check, instead of failing", async () => {
    const manifest = AdapterManifest.parse(
      JSON.parse(readFileSync(new URL("../../adapters/codex/manifest.json", import.meta.url), "utf8")),
    );
    const { event, refuted } = await checkClaims({
      repoRoot: tmpdir(),
      claims: ["something is true"],
      manifest,
      execute: () => Promise.resolve({ stdout: "", stderr: "", exitCode: 0 }),
    });

    expect(event.ran).toBe(false);
    expect(refuted).toEqual([]);
    expect(event.claims[0]?.verdict).toBe("unclear");
    expect(event.claims[0]?.evidence).toContain("not a git repository");
  });
});
