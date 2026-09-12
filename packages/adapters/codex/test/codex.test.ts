import { readFileSync } from "node:fs";
import { AdapterManifest, FanoutEvent, PlanGraph, type AdapterContext, type PlanLine } from "@fanout/core";
import { describe, expect, it } from "vitest";
import { createCodexAdapter, manifest } from "../src/index.ts";

/*
 * The contract test for the Codex seat, replayed against a stream recorded from a real run of codex 0.154.0
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
        seat: { id: "codex" },
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
    baseEnv: { PATH: "/usr/bin", HOME: "/Users/dev" },
    ...overrides,
  };
}

const adapter = createCodexAdapter();

describe("the Codex manifest", () => {
  it("is a valid manifest with its terms reviewed", () => {
    expect(AdapterManifest.safeParse(manifest).success).toBe(true);
    expect(manifest.terms.reviewedAt).not.toBeNull();
    expect(manifest.headless.stdin).toBe("closed");
  });
});

describe("the command Codex runs", () => {
  it("uses the documented non-interactive mode, in the workspace, writing its report where we ask", () => {
    const spec = adapter.command(context());
    expect(spec.argv).toEqual([
      "codex",
      "exec",
      "--json",
      "-C",
      "/work/sample",
      "-s",
      "workspace-write",
      "-o",
      "/runs/api-1/report.md",
      "Add hello.txt containing hello.",
    ]);
    expect(spec.cwd).toBe("/work/sample");
    expect(spec.env).toEqual({ PATH: "/usr/bin", HOME: "/Users/dev" });
    expect(spec.env).not.toBe(context().baseEnv);
  });

  it("runs an auditor read-only, and outside a git repository", () => {
    const spec = adapter.command(context({ line: line({ role: "auditor", scope: { write: [] } }) }));
    expect(spec.argv).toContain("read-only");
    expect(spec.argv).toContain("--skip-git-repo-check");
    expect(spec.argv).not.toContain("workspace-write");
  });

  it("passes the model and effort the plan chose", () => {
    const spec = adapter.command(
      context({ line: line({ seat: { id: "codex", model: "gpt-6-astra", effort: "high" } }) }),
    );
    expect(spec.argv).toContain("gpt-6-astra");
    expect(spec.argv.join(" ")).toContain('model_reasoning_effort="high"');
  });

  it("never carries a flag that hands over the machine", () => {
    const argv = adapter.command(context()).argv.join(" ");
    for (const flag of [
      "--dangerously-bypass-approvals-and-sandbox",
      "--approve-for-me",
      "danger-full-access",
    ]) {
      expect(argv).not.toContain(flag);
    }
  });
});

describe("parsing a recorded run", () => {
  const results = fixture.map((text) => adapter.parse(text, context()));
  const events = results.flatMap((result) => result.events);
  const signals = results.flatMap((result) => result.signals);

  it("turns every line into valid events", () => {
    for (const event of events) expect(FanoutEvent.safeParse(event).success).toBe(true);
    expect(results.every((result) => result.signals.every((signal) => signal.kind !== "unparsed"))).toBe(
      true,
    );
  });

  it("reports the session, the phases, the edit, the command and the usage", () => {
    expect(signals[0]).toEqual({ kind: "session", id: "01a092b7-742b-7fb2-80cc-649af6791440" });
    expect(events.filter((event) => event.type === "run.progress").map((event) => event.phase)).toEqual([
      "reading",
      "coding",
      "reporting",
    ]);
    expect(events.filter((event) => event.type === "run.tool")).toEqual([
      {
        type: "run.tool",
        missionId: "demo",
        runId: "api-1",
        tool: "edit",
        summary: "add",
        files: ["hello.txt"],
      },
      {
        type: "run.tool",
        missionId: "demo",
        runId: "api-1",
        tool: "shell",
        summary: "/bin/zsh -lc 'wc -c hello.txt && od -An -t x1 hello.txt && git status --short'",
        files: [],
      },
    ]);
    expect(events.find((event) => event.type === "run.usage")).toMatchObject({
      seat: "codex",
      amount: 57_342,
      unit: "tokens",
      estimated: false,
    });
  });

  it("keeps the CLI's own error instead of swallowing it, and the final message as the report", () => {
    expect(signals.filter((signal) => signal.kind === "error")).toHaveLength(1);
    const reports = signals.flatMap((signal) => (signal.kind === "report" ? [signal.text] : []));
    expect(reports).toHaveLength(2);
    expect(reports.at(-1)).toContain("hello.txt");
  });
});

describe("parsing anything else", () => {
  it.each([
    ["plain text", "not json"],
    ["an array", "[1,2]"],
    ["an unknown line type", '{"type":"turn.paused"}'],
    ["an item with no known type", '{"type":"item.completed","item":{"id":"x","type":"mystery"}}'],
    ["a usage line with no numbers", '{"type":"turn.completed","usage":{}}'],
  ])("never throws on %s", (_, text) => {
    expect(adapter.parse(text, context())).toEqual({
      events: [],
      signals: [{ kind: "unparsed", line: text }],
    });
  });

  it("recognises a usage limit as a limit, not a plain error", () => {
    const text = JSON.stringify({
      type: "item.completed",
      item: { id: "item_9", type: "error", message: "You've hit your usage limit. Try again after 4:10pm." },
    });
    expect(adapter.parse(text, context()).signals).toEqual([
      { kind: "limit", message: "You've hit your usage limit. Try again after 4:10pm." },
    ]);
  });

  it("marks a test command as the testing phase", () => {
    const text = JSON.stringify({
      type: "item.completed",
      item: {
        id: "item_9",
        type: "command_execution",
        command: "pnpm test",
        exit_code: 0,
        status: "completed",
      },
    });
    const { events } = adapter.parse(text, context());
    expect(events[0]).toMatchObject({ type: "run.progress", phase: "testing" });
  });

  it("keeps a path that lies outside the workspace exactly as the CLI reported it", () => {
    const text = JSON.stringify({
      type: "item.completed",
      item: {
        id: "item_9",
        type: "file_change",
        changes: [{ path: "/etc/hosts", kind: "modify" }],
        status: "completed",
      },
    });
    const { events } = adapter.parse(text, context());
    expect(events.find((event) => event.type === "run.tool")).toMatchObject({ files: ["/etc/hosts"] });
  });
});

/*
 * Codex is the one seat that reviews code itself, which is what gives us a second vendor's opinion inside P0
 * rather than P1. Recorded from a real `codex exec review --uncommitted --json` against a throwaway repository
 * whose uncommitted change added a mandatory parameter to an existing function.
 */
describe("the review Codex runs on its own", () => {
  const reviewFixture = readFileSync(new URL("../fixtures/review.jsonl", import.meta.url), "utf8")
    .trimEnd()
    .split("\n");

  it("declares the verified review invocation, with a target it must always be given", () => {
    const review = manifest.capabilities.review;
    expect(review).not.toBeNull();
    // Verified by running it: with no selector and no prompt the CLI exits 1 asking for one of
    // --uncommitted, --base or --commit. An agent's work sits uncommitted in its worktree, so that is ours.
    expect(review?.args).toContain("--uncommitted");
    expect(review?.args).toContain("review");
    expect(review?.args).toContain("--json");
  });

  it("speaks the same stream as an ordinary run, so one parser reads both", () => {
    const adapter = createCodexAdapter();
    const events = reviewFixture.flatMap((text) => adapter.parse(text, context()).events);

    expect(events.length).toBeGreaterThan(0);
    for (const event of events) expect(() => FanoutEvent.parse(event)).not.toThrow();
  });

  it("never leaves an unparsed line, which would mean the review format had drifted", () => {
    const adapter = createCodexAdapter();
    const unparsed = reviewFixture.flatMap((text) =>
      adapter.parse(text, context()).signals.filter((signal) => signal.kind === "unparsed"),
    );
    expect(unparsed).toEqual([]);
  });

  /*
   * The finding that shapes the merge gate: Codex reports its review as prose inside an `agent_message`, with a
   * "- [P1] title — path:lines" convention and no structured severity, file or range field. We therefore treat a
   * second-vendor review as a narrative for the lead to read, never as a machine-readable verdict to act on.
   */
  it("reports its findings as prose, not as a structured verdict", () => {
    const messages = reviewFixture
      .map((text) => JSON.parse(text) as { item?: { type?: string; text?: string } })
      .filter((line) => line.item?.type === "agent_message");

    expect(messages).toHaveLength(1);
    const text = messages[0]?.item?.text ?? "";
    expect(text).toContain("[P1]");
    // No severity, file or line field exists to read: the prose is the whole payload.
    const item = messages[0]?.item as Record<string, unknown>;
    expect(Object.keys(item).sort()).toEqual(["id", "text", "type"]);
  });

  it("carries no path from the machine it was recorded on", () => {
    const raw = reviewFixture.join("\n");
    expect(raw).not.toMatch(/\/Users\//);
    expect(raw).not.toContain("claude-501");
  });
});
