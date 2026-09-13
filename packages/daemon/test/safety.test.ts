import { PlanGraph, type LaunchSpec, type PlanLine, type SeatInfo } from "fanout-core";
import { describe, expect, it } from "vitest";
import { safetyReport, type RepositoryState, type SafetyDependencies } from "../src/safety/report.ts";
import type { SafetyInput } from "../src/safety/types.ts";

/*
 * The gate decides whether anything runs at all, so these tests try to get a bad plan past it.
 */

const BASE = "0".repeat(40);

function seat(overrides: Partial<SeatInfo> = {}): SeatInfo {
  return {
    id: "codex",
    displayName: "OpenAI Codex",
    binary: "codex",
    version: "0.154.0",
    supported: true,
    signedIn: "yes",
    models: [],
    efforts: [],
    billing: "subscription",
    plan: null,
    ...overrides,
  };
}

function line(id: string, overrides: Partial<PlanLine> = {}): PlanLine {
  const [parsed] = PlanGraph.parse({
    lines: [
      {
        id,
        title: id,
        role: "builder",
        prompt: "Build it.",
        seat: { id: "codex" },
        scope: { write: [`src/${id}/**`] },
        ...overrides,
      },
    ],
  }).lines;
  if (parsed === undefined) throw new Error("fixture plan has no line");
  return parsed;
}

function command(lineId: string, argv: [string, ...string[]] = ["codex", "exec", "--json"]): LaunchSpec {
  return { argv, cwd: `/work/${lineId}`, env: { PATH: "/usr/bin" } };
}

function input(lines: PlanLine[], overrides: Partial<SafetyInput> = {}): SafetyInput {
  return {
    plan: { lines },
    planRevision: 1,
    repo: { root: "/work/repo", baseCommit: BASE },
    seats: { codex: seat() },
    commands: Object.fromEntries(lines.map((entry) => [entry.id, command(entry.id)])),
    denyList: ["**/.env"],
    limits: { maxParallel: 4, perSeat: { codex: 3 } },
    ...overrides,
  };
}

function deps(overrides: Partial<SafetyDependencies> = {}): SafetyDependencies {
  const state: RepositoryState = { head: BASE, dirty: [] };
  return {
    deniedFiles: () => Promise.resolve([]),
    repositoryState: () => Promise.resolve(state),
    ...overrides,
  };
}

/** Every failing check that would stop a launch. */
function blockers(checks: { id: string; ok: boolean; severity: string }[]): string[] {
  return checks.filter((check) => !check.ok && check.severity === "block").map((check) => check.id);
}

describe("the safety gate", () => {
  it("passes a clean plan and shows the exact commands that would run", async () => {
    const report = await safetyReport(input([line("api"), line("ui")]), deps());

    expect(report.ok).toBe(true);
    expect(report.planRevision).toBe(1);
    expect(blockers(report.checks)).toEqual([]);
    expect(report.dryRun).toEqual([
      { lineId: "api", seat: "codex", argv: ["codex", "exec", "--json"], cwd: "/work/api" },
      { lineId: "ui", seat: "codex", argv: ["codex", "exec", "--json"], cwd: "/work/ui" },
    ]);
  });

  it("refuses parallel lines that could write the same file, and says which", async () => {
    const report = await safetyReport(
      input([line("api", { scope: { write: ["src/**"] } }), line("ui", { scope: { write: ["src/ui/**"] } })]),
      deps(),
    );

    expect(report.ok).toBe(false);
    expect(blockers(report.checks)).toContain("scopes-disjoint");
    const overlap = report.checks.find((check) => check.id === "scopes-disjoint");
    expect(overlap?.lineIds).toEqual(["api", "ui"]);
    expect(overlap?.message).toContain("src/**");
  });

  it("refuses a builder that declares no scope", async () => {
    const report = await safetyReport(input([line("api", { scope: { write: [] } })]), deps());
    expect(blockers(report.checks)).toContain("scopes-declared");
  });

  it("refuses to launch while the repository tracks something deny-listed", async () => {
    const report = await safetyReport(
      input([line("api")]),
      deps({ deniedFiles: () => Promise.resolve([".env", "deploy/server.key"]) }),
    );

    expect(report.ok).toBe(false);
    const secrets = report.checks.find((check) => check.id === "secrets-excluded");
    expect(secrets?.message).toContain(".env");
  });

  it.each([
    ["not installed", {}, "kimi"],
    ["an unsupported version", { kimi: seat({ id: "kimi", supported: false }) }, "kimi"],
    ["signed out", { kimi: seat({ id: "kimi", signedIn: "no" as const }) }, "kimi"],
  ])("refuses a line whose seat is %s", async (_, seats, seatId) => {
    const report = await safetyReport(
      input([line("api", { seat: { id: seatId } })], { seats: { codex: seat(), ...seats } }),
      deps(),
    );

    expect(blockers(report.checks)).toContain("seat-available");
    expect(report.checks.find((check) => check.id === "seat-available")?.lineIds).toEqual(["api"]);
  });

  it("warns, without blocking, when a CLI cannot tell us whether it is signed in", async () => {
    const seats = { kimi: seat({ id: "kimi", signedIn: "unknown" }) };
    const report = await safetyReport(input([line("api", { seat: { id: "kimi" } })], { seats }), deps());

    expect(report.ok).toBe(true);
    const warning = report.checks.find((check) => check.severity === "warn" && check.id === "seat-available");
    expect(warning?.message).toContain("unknown");
  });

  it.each([
    "--dangerously-skip-permissions",
    "--dangerously-bypass-approvals-and-sandbox",
    "--yolo",
    "--always-approve",
  ])("refuses a command carrying %s", async (flag) => {
    const report = await safetyReport(
      input([line("api")], { commands: { api: command("api", ["codex", "exec", flag]) } }),
      deps(),
    );

    expect(blockers(report.checks)).toContain("permission-mode");
    expect(report.checks.find((check) => check.id === "permission-mode")?.message).toContain(flag);
  });

  it("refuses a line with no command, because there is nothing to show before launch", async () => {
    const report = await safetyReport(input([line("api")], { commands: {} }), deps());
    expect(blockers(report.checks)).toContain("permission-mode");
  });

  it("never claims network isolation it cannot verify", async () => {
    const report = await safetyReport(input([line("api")]), deps());
    const network = report.checks.find((check) => check.id === "network");
    expect(network).toMatchObject({ severity: "warn", ok: true });
    expect(network?.message).toContain("cannot verify");
  });

  it.each([
    ["the mission limit", { maxParallel: 2, perSeat: {} }],
    ["a seat's limit", { maxParallel: 9, perSeat: { codex: 2 } }],
  ])("refuses a plan that would start more runs at once than %s allows", async (_, limits) => {
    const report = await safetyReport(input([line("a"), line("b"), line("c")], { limits }), deps());
    expect(blockers(report.checks)).toContain("concurrency");
  });

  it("counts only the lines that start at once, not the whole plan", async () => {
    const plan = [line("a"), line("b", { dependsOn: ["a"] }), line("c", { dependsOn: ["a"] })];
    const report = await safetyReport(input(plan, { limits: { maxParallel: 1, perSeat: {} } }), deps());
    expect(blockers(report.checks)).not.toContain("concurrency");
  });

  it("refuses to plan from a commit the repository is no longer on", async () => {
    const report = await safetyReport(
      input([line("api")]),
      deps({ repositoryState: () => Promise.resolve({ head: "f".repeat(40), dirty: [] }) }),
    );

    expect(blockers(report.checks)).toContain("base-commit");
    expect(report.checks.find((check) => check.id === "base-commit")?.message).toContain("fffffff");
  });

  it("refuses uncommitted work inside a line's scope, but allows it elsewhere", async () => {
    const inScope = await safetyReport(
      input([line("api")]),
      deps({ repositoryState: () => Promise.resolve({ head: BASE, dirty: ["src/api/csv.ts"] }) }),
    );
    const elsewhere = await safetyReport(
      input([line("api")]),
      deps({ repositoryState: () => Promise.resolve({ head: BASE, dirty: ["README.md"] }) }),
    );

    expect(blockers(inScope.checks)).toContain("base-commit");
    expect(blockers(elsewhere.checks)).toEqual([]);
  });

  it("is green only when no blocking check failed", async () => {
    const report = await safetyReport(
      input([line("api", { scope: { write: ["src/**"] } }), line("ui", { scope: { write: ["src/**"] } })]),
      deps({ deniedFiles: () => Promise.resolve([".env"]) }),
    );

    expect(report.ok).toBe(false);
    expect(blockers(report.checks).length).toBeGreaterThan(1);
    expect(report.checks.every((check) => check.message.length > 0)).toBe(true);
  });
});
