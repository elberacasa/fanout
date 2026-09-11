import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FanoutEvent, PlanGraph, type AdapterContext } from "@fanout/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createFakeAdapter,
  EXIT,
  FAKE_CLI_PATH,
  parseLine,
  Scenario,
  type ScenarioInput,
} from "../src/index.ts";

const FIXTURES = new URL("../fixtures/", import.meta.url);
const fixture = (name: string): string => readFileSync(new URL(name, FIXTURES), "utf8");
const basicScenario = JSON.parse(fixture("basic.scenario.json")) as ScenarioInput;

const [planLine] = PlanGraph.parse({
  lines: [
    {
      id: "api",
      title: "API",
      role: "builder",
      prompt: "-starts with a dash",
      seat: { id: "fake" },
      scope: { write: ["src/**"] },
    },
  ],
}).lines;
if (planLine === undefined) throw new Error("fixture plan has no line");

let dir: string;
let context: AdapterContext;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "fanout-fake-"));
  context = {
    missionId: "demo",
    runId: "api-1",
    line: planLine,
    workdir: join(dir, "work"),
    reportPath: join(dir, "runs", "api-1", "report.md"),
    baseEnv: { PATH: process.env["PATH"] ?? "" },
  };
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

interface CliResult {
  code: number | null;
  stdout: string;
  stderr: string;
  elapsedMs: number;
}

/** Runs the fake CLI the way the supervisor will: absolute path, stdin closed. */
function runCli(cwd: string, args: string[], options: { killAfterMs?: number } = {}): Promise<CliResult> {
  const started = performance.now();
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [FAKE_CLI_PATH, ...args], {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => (stdout += chunk.toString()));
    child.stderr.on("data", (chunk: Buffer) => (stderr += chunk.toString()));
    child.on("error", reject);
    if (options.killAfterMs !== undefined) setTimeout(() => child.kill("SIGKILL"), options.killAfterMs);
    child.on("close", (code) => {
      resolve({ code, stdout, stderr, elapsedMs: performance.now() - started });
    });
  });
}

function play(scenario: ScenarioInput, cwd = dir, report = "report.md"): Promise<CliResult> {
  return runCli(cwd, ["--scenario-json", JSON.stringify(scenario), "--report", report, "--", "do it"]);
}

describe("fake seat contract (recorded stream)", () => {
  it("the fixture is exactly what the CLI prints for its scenario", async () => {
    const result = await play(basicScenario);
    expect(result.code).toBe(0);
    expect(result.stdout).toBe(fixture("basic.jsonl"));
  });

  it("parses the recorded stream into valid events and signals", () => {
    const results = fixture("basic.jsonl")
      .trimEnd()
      .split("\n")
      .map((line) => parseLine(line, context));
    const run = { missionId: "demo", runId: "api-1" };
    expect(results).toEqual([
      {
        events: [{ type: "run.progress", ...run, phase: "reading", detail: "inspect repository" }],
        signals: [],
      },
      {
        events: [
          { type: "run.tool", ...run, tool: "edit", summary: "add csv writer", files: ["src/api/csv.ts"] },
        ],
        signals: [],
      },
      {
        events: [{ type: "run.usage", ...run, seat: "fake", amount: 2, unit: "messages", estimated: false }],
        signals: [],
      },
      { events: [{ type: "run.progress", ...run, phase: "reporting" }], signals: [] },
      { events: [], signals: [{ kind: "report", text: "Added the endpoint." }] },
    ]);
    for (const event of results.flatMap((result) => result.events)) {
      expect(FanoutEvent.safeParse(event).success).toBe(true);
    }
  });

  it.each([
    ["plain text", "not json"],
    ["a JSON array", "[1,2]"],
    ["an unknown kind", '{"kind":"mystery"}'],
    ["a wrong field type", '{"kind":"tool","tool":"edit","files":[1]}'],
    ["an unknown phase", '{"kind":"phase","phase":"dreaming"}'],
    ["an extra field", '{"kind":"usage","amount":1,"unit":"messages","secret":"x"}'],
  ])("never throws on %s", (_, line) => {
    expect(parseLine(line, context)).toEqual({ events: [], signals: [{ kind: "unparsed", line }] });
  });
});

describe("fake CLI", () => {
  it("prints the same bytes for the same scenario", async () => {
    const first = await play(basicScenario, mkdtempSync(join(dir, "a-")));
    const second = await play(basicScenario, mkdtempSync(join(dir, "b-")));
    expect(first.stdout).toBe(second.stdout);
  });

  it("really writes its files, and its report where the daemon asks, even outside the worktree", async () => {
    const work = mkdtempSync(join(dir, "work-"));
    const report = join(dir, "runs", "api-1", "report.md");
    const result = await play(basicScenario, work, report);
    expect(result.code).toBe(0);
    expect(readFileSync(join(work, "src/api/csv.ts"), "utf8")).toContain("export const csv");
    expect(readFileSync(report, "utf8")).toBe("Added the endpoint.");
  });

  it.each([["/tmp/fanout-escape.txt"], ["../escape.txt"], ["src/../../escape.txt"]])(
    "refuses to write %s and writes nothing",
    async (path) => {
      const work = mkdtempSync(join(dir, "work-"));
      const result = await play(
        { steps: [{ tool: "edit", write: { "ok.txt": "x", [path]: "x" } }], report: "" },
        work,
      );
      expect(result.code).toBe(EXIT.unsafeWrite);
      expect(existsSync(join(work, "ok.txt"))).toBe(false);
      expect(existsSync(join(dir, "escape.txt"))).toBe(false);
    },
  );

  it.each([
    [
      "an invalid scenario",
      ["--scenario-json", '{"steps":[{"nope":true}],"report":""}', "--report", "r", "--", "p"],
    ],
    ["scenario JSON that doesn't parse", ["--scenario-json", "{", "--report", "r", "--", "p"]],
    ["a missing prompt", ["--scenario-json", '{"steps":[],"report":""}', "--report", "r"]],
    ["a missing report path", ["--scenario-json", '{"steps":[],"report":""}', "--", "p"]],
    [
      "an unknown flag",
      ["--scenario-json", '{"steps":[],"report":""}', "--report", "r", "--yolo", "--", "p"],
    ],
  ])("exits 64 on %s", async (_, args) => {
    const result = await runCli(dir, args);
    expect(result.code).toBe(EXIT.usage);
    expect(result.stderr).toMatch(/^fake seat: /);
  });

  it("stops at a limit step: prints the limit, writes the report, exits 2", async () => {
    const result = await play({
      steps: [{ usage: 1 }, { limit: "usage limit reached" }, { phase: "coding" }],
      report: "Ran out of usage.",
    });
    expect(result.code).toBe(EXIT.limit);
    expect(result.stdout).toBe(
      '{"kind":"usage","amount":1,"unit":"messages"}\n{"kind":"limit","message":"usage limit reached"}\n',
    );
    expect(readFileSync(join(dir, "report.md"), "utf8")).toBe("Ran out of usage.");
  });

  it("exits with the scenario's exit code", async () => {
    expect((await play({ steps: [], report: "", exitCode: 3 })).code).toBe(3);
  });

  it("keeps running when told to hang, until it is killed", async () => {
    const result = await runCli(
      dir,
      ["--scenario-json", JSON.stringify({ steps: [], report: "", hang: true }), "--report", "r", "--", "p"],
      { killAfterMs: 600 },
    );
    expect(result.code).toBeNull();
    expect(result.stdout).toBe('{"kind":"report","text":""}\n');
  });

  it("scales every delay by timeScale", async () => {
    const slow = await play({ steps: [{ sleep: 300 }], report: "", timeScale: 1 });
    const instant = await play({ steps: [{ sleep: 300 }], report: "", timeScale: 0 });
    expect(slow.elapsedMs - instant.elapsedMs).toBeGreaterThan(200);
  });
});

describe("createFakeAdapter", () => {
  it("builds the exact command, with the prompt after `--` and a copy of the allowed environment", () => {
    const adapter = createFakeAdapter({ scenarioFor: () => ({ steps: [], report: "ok" }) });
    const spec = adapter.command(context);
    expect(spec).toEqual({
      argv: [
        process.execPath,
        FAKE_CLI_PATH,
        "--scenario-json",
        JSON.stringify(Scenario.parse({ steps: [], report: "ok" })),
        "--report",
        context.reportPath,
        "--",
        "-starts with a dash",
      ],
      cwd: context.workdir,
      env: context.baseEnv,
    });
    expect(spec.env).not.toBe(context.baseEnv);
  });

  it("refuses an invalid scenario before anything runs", () => {
    const adapter = createFakeAdapter({
      scenarioFor: () => ({ steps: [{ nope: true }], report: "" }) as never,
    });
    expect(() => adapter.command(context)).toThrow();
  });
});
