import { readFileSync } from "node:fs";
import { AdapterManifest, FanoutEvent, PlanGraph, type AdapterContext, type PlanLine } from "@fanout/core";
import { describe, expect, it } from "vitest";
import { createClaudeAdapter, manifest } from "../src/index.ts";

/*
 * The contract test for the Claude seat, replayed against a stream recorded from a real run of claude 2.1.269
 * (fixtures/basic.jsonl, paths and anything naming the owner's own setup scrubbed).
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
        seat: { id: "claude" },
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

const adapter = createClaudeAdapter();

describe("the Claude manifest", () => {
  it("is valid, opt-in, and honest about how headless use is billed", () => {
    expect(AdapterManifest.safeParse(manifest).success).toBe(true);
    expect(manifest.billing).toBe("subscription");
    expect(manifest.terms.notes).toContain("opt-in");
    expect(manifest.signIn.probe).toEqual(["auth", "status"]);
  });
});

describe("the command Claude runs", () => {
  it("uses the documented non-interactive mode and denies prompts rather than bypassing them", () => {
    const argv = adapter.command(context()).argv;
    expect(argv).toEqual([
      "claude",
      "-p",
      "Add hello.txt containing hello.",
      "--output-format",
      "stream-json",
      "--verbose",
      "--permission-mode",
      "acceptEdits",
      "--permission-prompts",
      "none",
    ]);
    expect(argv).not.toContain("--dangerously-skip-permissions");
    expect(argv).not.toContain("bypassPermissions");
  });

  it("puts an auditor in plan mode", () => {
    const spec = adapter.command(context({ line: line({ role: "auditor", scope: { write: [] } }) }));
    expect(spec.argv).toContain("plan");
    expect(spec.argv).not.toContain("acceptEdits");
  });

  it("passes the model and effort the plan chose", () => {
    const spec = adapter.command(
      context({ line: line({ seat: { id: "claude", model: "haiku", effort: "low" } }) }),
    );
    expect(spec.argv).toContain("haiku");
    expect(spec.argv).toContain("--effort");
  });
});

describe("parsing a recorded run", () => {
  const results = fixture.map((text) => adapter.parse(text, context()));
  const events = results.flatMap((result) => result.events);
  const signals = results.flatMap((result) => result.signals);

  it("turns every line into valid events, with nothing unparsed", () => {
    for (const event of events) expect(FanoutEvent.safeParse(event).success).toBe(true);
    expect(signals.filter((signal) => signal.kind === "unparsed")).toEqual([]);
  });

  it("names the session and the file it wrote", () => {
    expect(signals.find((signal) => signal.kind === "session")).toEqual({
      kind: "session",
      id: "6c2311e7-2de7-4fb9-b661-2d564e7c081f",
    });
    expect(events.filter((event) => event.type === "run.tool")).toEqual([
      { type: "run.tool", missionId: "demo", runId: "api-1", tool: "Write", files: ["hello.txt"] },
    ]);
  });

  it("reports the quota windows the CLI actually tells us about", () => {
    expect(signals.filter((signal) => signal.kind === "quota")).toEqual([
      {
        kind: "quota",
        window: "five_hour",
        utilization: 0.28,
        resetsAt: new Date(1_789_173_000_000).toISOString(),
      },
      {
        kind: "quota",
        window: "seven_day",
        utilization: 0.49,
        resetsAt: new Date(1_789_408_800_000).toISOString(),
      },
    ]);
  });

  it("separates the tokens it estimates mid-run from the count it gives at the end", () => {
    const usage = events.filter((event) => event.type === "run.usage");
    expect(usage.filter((event) => event.estimated).map((event) => event.amount)).toEqual([50, 50, 145]);
    expect(usage.filter((event) => !event.estimated)).toEqual([
      {
        type: "run.usage",
        missionId: "demo",
        runId: "api-1",
        seat: "claude",
        amount: 433,
        unit: "tokens",
        estimated: false,
      },
    ]);
  });

  it("ends in the reporting phase with the run's answer as its report", () => {
    expect(events.filter((event) => event.type === "run.progress").map((event) => event.phase)).toEqual([
      "reading",
      "coding",
      "reporting",
    ]);
    const report = signals.flatMap((signal) => (signal.kind === "report" ? [signal.text] : []));
    expect(report).toEqual(['Done. Created hello.txt with the word "hello".']);
  });
});

describe("parsing anything else", () => {
  it("turns a refused window into a limit, with the time it resets", () => {
    const text = JSON.stringify({
      type: "rate_limit_event",
      rate_limit_info: { status: "rejected", rateLimitType: "five_hour", resetsAt: 1_789_173_000 },
    });
    expect(adapter.parse(text, context()).signals).toEqual([
      {
        kind: "limit",
        message: "Claude reported the five_hour window as rejected",
        resetsAt: new Date(1_789_173_000_000).toISOString(),
      },
    ]);
  });

  it("keeps an error result as an error as well as a report", () => {
    const text = JSON.stringify({
      type: "result",
      subtype: "error_during_execution",
      is_error: true,
      result: "the model refused",
    });
    const { signals } = adapter.parse(text, context());
    expect(signals).toContainEqual({ kind: "error", message: "the model refused" });
  });

  it.each([
    ["plain text", "not json"],
    ["an array", "[1,2]"],
    ["an unknown shape", '{"type":"assistant"}'],
  ])("never throws on %s", (_, text) => {
    expect(adapter.parse(text, context())).toEqual({
      events: [],
      signals: [{ kind: "unparsed", line: text }],
    });
  });

  it("calls a test command the testing phase", () => {
    const text = JSON.stringify({
      type: "assistant",
      message: { content: [{ type: "tool_use", name: "Bash", input: { command: "pnpm test" } }] },
    });
    expect(adapter.parse(text, context()).events[0]).toMatchObject({
      type: "run.progress",
      phase: "testing",
    });
  });
});
