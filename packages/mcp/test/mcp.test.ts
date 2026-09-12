import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createFakeAdapter } from "@fanout/adapter-fake";
import { AdapterManifest, Ledger, project, type SeatAdapter } from "@fanout/core";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createFanoutServer } from "../src/server.ts";

/*
 * The lead's tools, exercised the way Claude Code will: a real MCP client on one end, a real git repository and
 * the real fake-seat CLI on the other.
 */

const FAKE = AdapterManifest.parse({
  id: "fake",
  displayName: "Fake seat",
  binary: "fake",
  supportedVersions: ">=0.1 <1",
  tier: "reference",
  capabilities: { resume: null, fork: null, review: null, plan: null },
  headless: { args: ["{prompt}"], stdin: "closed" },
  stream: { flag: null, format: "jsonl" },
  models: [],
  efforts: [],
  permissionModes: { readOnly: "read-only", edit: "workspace-write" },
  network: { canDisable: true, flag: null },
  signIn: { probe: null, okPattern: null, noPattern: null },
  usage: { probe: null, window: "unknown" },
  billing: "subscription",
  terms: { reviewedAt: "2026-09-11", notes: "A simulated seat: no vendor, no terms." },
  status: "alpha",
});

const gitEnv = {
  PATH: process.env["PATH"] ?? "",
  HOME: process.env["HOME"] ?? "",
  GIT_CONFIG_NOSYSTEM: "1",
  LC_ALL: "C",
};

let dir: string;
let repo: string;
let ledger: Ledger;
let client: Client;
let adapter: SeatAdapter;

function git(args: string[]): string {
  return execFileSync("git", args, { cwd: repo, encoding: "utf8", env: gitEnv });
}

function line(id: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id,
    title: id,
    role: "builder",
    prompt: `Do ${id}.`,
    seat: { id: "fake" },
    scope: { write: [`src/${id}/**`] },
    ...overrides,
  };
}

async function call(
  name: string,
  args: Record<string, unknown> = {},
): Promise<{ text: string; data: unknown }> {
  const result = await client.callTool({ name, arguments: args });
  const content = (result.content ?? []) as { type: string; text?: string }[];
  return { text: content.map((part) => part.text ?? "").join("\n"), data: result.structuredContent };
}

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), "fanout-mcp-"));
  repo = join(dir, "repo");
  mkdirSync(join(repo, "src"), { recursive: true });
  git(["init", "--quiet", "-b", "main"]);
  git(["config", "user.email", "crew@example.invalid"]);
  git(["config", "user.name", "Fanout tests"]);
  writeFileSync(join(repo, "README.md"), "# sample\n");
  writeFileSync(join(repo, "package.json"), JSON.stringify({ name: "sample", scripts: { check: "true" } }));
  writeFileSync(join(repo, "src", "index.ts"), "export const sample = 1;\n");
  git(["add", "-A"]);
  git(["commit", "--quiet", "-m", "seed"]);

  ledger = Ledger.open(":memory:");
  adapter = createFakeAdapter({
    scenarioFor: (planLine) => ({
      steps: [
        { phase: "coding" },
        { tool: "edit", write: { [`src/${planLine.id}/made.ts`]: `export const ${planLine.id} = 1;\n` } },
      ],
      report: `${planLine.id} done`,
      timeScale: 0,
    }),
  });

  const server = createFanoutServer({
    ledger,
    repoRoot: repo,
    paths: { runs: join(dir, "runs"), workspaces: join(dir, "workspaces") },
    adapters: new Map([["fake", adapter]]),
    manifests: [FAKE],
    limits: {
      startTimeoutMs: 10_000,
      timeoutMs: 30_000,
      killGraceMs: 300,
      maxLogBytes: 1_000_000,
      maxLineBytes: 100_000,
    },
    execute: () => Promise.resolve({ stdout: "0.1.0", stderr: "", exitCode: 0 }),
  });

  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  client = new Client({ name: "test-lead", version: "1.0.0" });
  await Promise.all([server.connect(serverSide), client.connect(clientSide)]);
});

afterEach(async () => {
  await client.close();
  ledger.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("the tools the lead gets", () => {
  it("offers exactly the tools that work today, and none that pretend to merge", async () => {
    const { tools } = await client.listTools();
    const names = tools.map((tool) => tool.name).sort();
    expect(names).toEqual([
      "cancel_mission",
      "check_claims",
      "launch",
      "mission_status",
      "plan_check",
      "repo_overview",
      "run_diff",
      "seats",
    ]);
    expect(names).not.toContain("merge");
  });

  it("reports the crew", async () => {
    const { text, data } = await call("seats");
    expect(text).toContain("seats are ready");
    expect((data as { seats: { id: string }[] }).seats.map((seat) => seat.id)).toEqual(["fake"]);
  });

  it("maps the repository well enough to plan from", async () => {
    const { data } = await call("repo_overview");
    const overview = data as { head: string; dirty: string[]; areas: { path: string }[]; checks: string[] };
    expect(overview.head).toMatch(/^[0-9a-f]{40}$/);
    expect(overview.dirty).toEqual([]);
    expect(overview.areas.map((area) => area.path)).toContain("src/");
    expect(overview.checks).toContain("npm run check");
  });
});

describe("checking a plan", () => {
  it("says a good plan is ready", async () => {
    const { text } = await call("plan_check", { lines: [line("api"), line("ui")] });
    expect(text).toContain("ready to launch");
  });

  it("refuses one where two lines could write the same file, and says which", async () => {
    const { text } = await call("plan_check", {
      lines: [line("api", { scope: { write: ["src/**"] } }), line("ui", { scope: { write: ["src/ui/**"] } })],
    });
    expect(text).toContain("cannot launch");
    expect(text).toContain("api");
  });
});

describe("launching a mission", () => {
  it("runs the plan and records the whole story", async () => {
    const launched = await call("launch", { goal: "Add CSV export", lines: [line("api"), line("ui")] });
    const missionId = (launched.data as { missionId: string }).missionId;
    expect(launched.text).toContain("is running 2 line(s)");

    await waitFor(() => project(ledger.read()).missions[missionId]?.status === "finished");

    const status = await call("mission_status", { missionId });
    expect(status.text).toContain("finished");
    // Run id, seat, status and a measured elapsed time on one row; a finished run is never marked quiet.
    expect(status.text).toMatch(/api-1\s+fake\s+done\s+\S+\s+\w+\s+\d+s/);
    expect(status.text).not.toContain("quiet");

    const diff = await call("run_diff", { missionId, runId: "api-1", patch: true });
    const result = diff.data as { stat: { files: number }; report: string | null; patch?: string };
    expect(result.stat.files).toBe(1);
    expect(result.report).toContain("api done");
    expect(diff.text).toContain("1 file(s)");
  });

  it("will not launch a plan the gate refuses, and says what to do about it", async () => {
    const { text } = await call("launch", {
      goal: "Break everything",
      lines: [line("api", { scope: { write: ["src/**"] } }), line("ui", { scope: { write: ["src/ui/**"] } })],
    });
    expect(text).toContain("cannot run");
    expect(project(ledger.read()).missions).toEqual({});
  });

  it("says plainly when a mission it never started is asked about", async () => {
    expect((await call("mission_status", { missionId: "nope" })).text).toContain("No mission called nope");
    expect((await call("cancel_mission", { missionId: "nope", reason: "changed my mind" })).text).toContain(
      "not running here",
    );
  });
});

async function waitFor(condition: () => boolean, timeoutMs = 20_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error("the mission never finished");
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}
