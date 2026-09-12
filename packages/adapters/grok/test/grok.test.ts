import { readFileSync } from "node:fs";
import { AdapterManifest, FanoutEvent, PlanGraph, type AdapterContext, type PlanLine } from "@fanout/core";
import { describe, expect, it } from "vitest";
import { createGrokAdapter, manifest } from "../src/index.ts";

/*
 * The contract test for the Grok seat, replayed against a stream recorded from a real run of grok 1.0.13
 * (fixtures/basic.jsonl, paths scrubbed). A version bump means a new recording, never a guess.
 */

const fixture = readFileSync(new URL("../fixtures/basic.jsonl", import.meta.url), "utf8")
  .trimEnd()
  .split("\n");

function line(overrides: Partial<PlanLine> = {}): PlanLine {
  const [parsed] = PlanGraph.parse({
    lines: [
      {
        id: "api",
        title: "API",
        role: "builder",
        prompt: "Add hello.txt containing hello.",
        seat: { id: "grok" },
        scope: { write: ["**"] },
        ...overrides,
      },
    ],
  }).lines;
  if (parsed === undefined) throw new Error("fixture plan has no line");
  return parsed;
}

function context(overrides: Partial<AdapterContext> = {}): AdapterContext {
  return {
    missionId: "demo",
    runId: "api-1",
    line: line(),
    workdir: "/work/sample",
    reportPath: "/runs/api-1/report.md",
    baseEnv: { PATH: "/usr/bin" },
    ...overrides,
  };
}

describe("the Grok manifest", () => {
  it("is valid, with its terms reviewed and sign-in honestly unknown", () => {
    expect(AdapterManifest.safeParse(manifest).success).toBe(true);
    expect(manifest.terms.reviewedAt).not.toBeNull();
    // The CLI has no status command, so the crew must not claim to know whether it is signed in.
    expect(manifest.signIn.probe).toBeNull();
  });
});

describe("the command Grok runs", () => {
  it("uses the documented single-turn mode with structured output", () => {
    expect(createGrokAdapter().command(context()).argv).toEqual([
      "grok",
      "-p",
      "Add hello.txt containing hello.",
      "--output-format",
      "streaming-json",
      "--permission-mode",
      "acceptEdits",
      "--cwd",
      "/work/sample",
    ]);
  });

  it("puts an auditor in plan mode, where it cannot edit", () => {
    const spec = createGrokAdapter().command(
      context({ line: line({ role: "auditor", scope: { write: [] } }) }),
    );
    expect(spec.argv).toContain("plan");
    expect(spec.argv).not.toContain("acceptEdits");
  });

  it("passes the model and effort the plan chose, and nothing dangerous", () => {
    const spec = createGrokAdapter().command(
      context({ line: line({ seat: { id: "grok", model: "grok-4.6", effort: "low" } }) }),
    );
    expect(spec.argv).toContain("grok-4.6");
    expect(spec.argv).toContain("--reasoning-effort");
    for (const flag of ["bypassPermissions", "--always-approve", "dontAsk"]) {
      expect(spec.argv.join(" ")).not.toContain(flag);
    }
  });
});

describe("parsing a recorded run", () => {
  const adapter = createGrokAdapter();
  const results = fixture.map((text) => adapter.parse(text, context()));
  const events = results.flatMap((result) => result.events);
  const signals = results.flatMap((result) => result.signals);

  it("turns every line into valid events, with nothing unparsed", () => {
    for (const event of events) expect(FanoutEvent.safeParse(event).success).toBe(true);
    expect(signals.filter((signal) => signal.kind === "unparsed")).toEqual([]);
  });

  it("reports the file it wrote, relative to the workspace", () => {
    expect(events.filter((event) => event.type === "run.tool")).toEqual([
      { type: "run.tool", missionId: "demo", runId: "api-1", tool: "write", files: ["hello.txt"] },
    ]);
  });

  it("counts the tokens of every turn", () => {
    const usage = events.filter((event) => event.type === "run.usage");
    expect(usage.map((event) => event.amount)).toEqual([9012, 292]);
    expect(usage.every((event) => event.unit === "tokens" && !event.estimated)).toBe(true);
  });

  /*
   * Grok announces its tool list four times in this one recorded run. Reading each announcement as progress
   * walked the phase back to `reading` after the write — on the mission view, an agent that gave up and started
   * over. Every other test here passed while it did that, because none of them looked at the whole sequence.
   */
  it("never walks the phase backwards when the CLI repeats its handshake", () => {
    const phases = events.flatMap((event) => (event.type === "run.progress" ? [event.phase] : []));

    expect(phases).toEqual(["reading", "coding", "reporting"]);
  });

  it("ends in the reporting phase, with the session and the assembled report", () => {
    expect(events.filter((event) => event.type === "run.progress").at(-1)).toMatchObject({
      phase: "reporting",
    });
    expect(signals.filter((signal) => signal.kind === "session")).toEqual([
      { kind: "session", id: "01a092ca-53e2-7122-8797-20c562f00eb5" },
    ]);
    const report = signals.flatMap((signal) => (signal.kind === "report" ? [signal.text] : []));
    expect(report).toHaveLength(1);
    expect(report[0]).toContain("Created `hello.txt`");
  });
});

describe("assembling prose that arrives in pieces", () => {
  it("keeps each run's words apart and forgets them once reported", () => {
    const adapter = createGrokAdapter();
    const first = context({ runId: "api-1" });
    const second = context({ runId: "ui-1" });

    adapter.parse(JSON.stringify({ type: "text", data: "one " }), first);
    adapter.parse(JSON.stringify({ type: "text", data: "two" }), second);
    adapter.parse(JSON.stringify({ type: "text", data: "and a half" }), first);

    const firstEnd = adapter.parse(JSON.stringify({ type: "end", stopReason: "end_turn" }), first);
    expect(firstEnd.signals).toEqual([{ kind: "report", text: "one and a half" }]);

    const secondEnd = adapter.parse(JSON.stringify({ type: "end", stopReason: "end_turn" }), second);
    expect(secondEnd.signals).toEqual([{ kind: "report", text: "two" }]);

    // Nothing is left over for a run that ends twice.
    expect(adapter.parse(JSON.stringify({ type: "end" }), first).signals).toEqual([]);
  });
});

describe("parsing anything else", () => {
  it.each([
    ["plain text", "not json"],
    ["an array", "[1,2]"],
    ["an unknown line type", '{"type":"session_paused"}'],
    ["a usage line with no numbers", '{"type":"usage","usage":{}}'],
    ["a tool call with no id", '{"type":"tool_call","toolName":"write"}'],
  ])("never throws on %s", (_, text) => {
    expect(createGrokAdapter().parse(text, context())).toEqual({
      events: [],
      signals: [{ kind: "unparsed", line: text }],
    });
  });

  it("keeps a path outside the workspace exactly as the CLI reported it", () => {
    const text = JSON.stringify({
      type: "tool_call",
      toolCallId: "call-1",
      toolName: "write",
      rawInput: { file_path: "/etc/hosts", content: "" },
    });
    const { events } = createGrokAdapter().parse(text, context());
    expect(events.find((event) => event.type === "run.tool")).toMatchObject({ files: ["/etc/hosts"] });
  });

  it("calls a test command the testing phase", () => {
    const text = JSON.stringify({
      type: "tool_call",
      toolCallId: "call-2",
      toolName: "run_terminal_command",
      rawInput: { command: "pnpm test" },
    });
    const { events } = createGrokAdapter().parse(text, context());
    expect(events[0]).toMatchObject({ type: "run.progress", phase: "testing" });
  });
});
