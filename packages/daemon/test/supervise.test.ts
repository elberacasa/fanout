import { mkdtempSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { supervise } from "../src/supervisor/supervise.ts";
import type { OutputStream, RunHandle, SuperviseOptions } from "../src/supervisor/types.ts";

let dir: string;
let logPath: string;
let runs: RunHandle[];

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "fanout-supervisor-"));
  logPath = join(dir, "run.log");
  runs = [];
});

afterEach(async () => {
  await Promise.all(runs.map((run) => run.kill("test cleanup")));
  vi.unstubAllEnvs();
  rmSync(dir, { recursive: true, force: true });
});

function launch(fixture: string, overrides: Partial<SuperviseOptions> = {}) {
  const lines: { line: string; stream: OutputStream }[] = [];
  const onStarted = vi.fn();
  const run = supervise({
    runId: "test-run",
    spec: {
      argv: [process.execPath, fileURLToPath(new URL(`./fixtures/${fixture}.mjs`, import.meta.url))],
      cwd: dir,
      env: {},
    },
    logPath,
    startTimeoutMs: 700,
    timeoutMs: 1800,
    killGraceMs: 80,
    maxLogBytes: 4096,
    maxLineBytes: 1024,
    onStarted,
    onLine: (line, stream) => {
      lines.push({ line, stream });
    },
    ...overrides,
  });
  runs.push(run);
  return {
    run,
    lines,
    onStarted,
    output: (stream: OutputStream) => lines.filter((item) => item.stream === stream).map((item) => item.line),
  };
}

function exists(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (cause) {
    if (cause instanceof Error && "code" in cause && cause.code === "ESRCH") return false;
    throw cause;
  }
}

describe("supervise", () => {
  it("captures both streams, blank lines, CRLF and final lines in a private log", async () => {
    const { run, output, onStarted } = launch("lines");
    expect(run.runId).toBe("test-run");
    expect(run.pid).toBeTypeOf("number");
    const result = await run.done;
    expect(result).toMatchObject({ status: "done", exitCode: 0, signal: null, startDetected: true });
    expect(result.durationMs).toBeGreaterThan(0);
    expect(result.durationMs).toBeLessThan(2000);
    expect(onStarted).toHaveBeenCalledTimes(1);
    expect(output("stdout")).toEqual(["first", "second", "", "last"]);
    expect(output("stderr")).toEqual(["warning", "final warning"]);
    const log = readFileSync(logPath, "utf8");
    expect(log).toContain("first\nsecond\n\n");
    expect(log).toContain("last\n");
    expect(log).toContain("[stderr] warning\n");
    expect(log).toContain("[stderr] final warning\n");
    expect(statSync(logPath).mode & 0o777).toBe(0o600);
  });

  it("appends to an existing log", async () => {
    writeFileSync(logPath, "existing\n", { mode: 0o600 });
    await launch("lines").run.done;
    expect(readFileSync(logPath, "utf8").startsWith("existing\n")).toBe(true);
  });

  it("reports a nonzero exit", async () => {
    expect(await launch("exit-three").run.done).toMatchObject({
      status: "failed",
      exitCode: 3,
      signal: null,
      startDetected: true,
    });
  });

  it("closes stdin immediately", async () => {
    const { run, output } = launch("stdin");
    expect((await run.done).status).toBe("done");
    expect(output("stdout")).toEqual(["EOF:0"]);
  });

  it.each(["silent", "stderr-only"])("fails start detection for %s", async (fixture) => {
    const { run, onStarted } = launch(fixture, { startTimeoutMs: 200 });
    expect(await run.done).toMatchObject({
      status: "failed",
      exitCode: null,
      signal: "SIGTERM",
      startDetected: false,
      error: "No stdout received within 200 ms",
    });
    expect(onStarted).not.toHaveBeenCalled();
  });

  it("detects the first byte before a line is complete", async () => {
    const { run, onStarted, output } = launch("byte-then-sleep");
    await vi.waitFor(
      () => {
        expect(onStarted).toHaveBeenCalledTimes(1);
      },
      { timeout: 900 },
    );
    expect(output("stdout")).toEqual([]);
    expect((await run.kill("observed start")).startDetected).toBe(true);
    expect(output("stdout")).toEqual(["x"]);
  });

  it("enforces the overall wall-clock timeout", async () => {
    const { run } = launch("sleep", { timeoutMs: 300 });
    const result = await run.done;
    expect(result).toMatchObject({ status: "timeout", signal: "SIGTERM", startDetected: true });
    expect(result.durationMs).toBeGreaterThanOrEqual(280);
  });

  it("preserves timeout status when kill is called during the grace period", async () => {
    const { run, output } = launch("ignore-term", { timeoutMs: 250, killGraceMs: 150 });
    await vi.waitFor(
      () => {
        expect(output("stderr")).toContain("ignored SIGTERM");
      },
      { timeout: 700 },
    );
    expect((await run.kill("too late")).status).toBe("timeout");
  });

  it("escalates SIGTERM to SIGKILL after grace and makes repeated kills safe", async () => {
    const { run, onStarted, output } = launch("ignore-term", { killGraceMs: 120 });
    await vi.waitFor(
      () => {
        expect(onStarted).toHaveBeenCalledOnce();
      },
      { timeout: 900 },
    );
    const began = performance.now();
    const first = run.kill("cancel");
    expect(run.kill("cancel again")).toBe(first);
    const result = await first;
    expect(result).toMatchObject({ status: "killed", exitCode: null, signal: "SIGKILL" });
    expect(performance.now() - began).toBeGreaterThanOrEqual(110);
    expect(output("stderr")).toEqual(["ignored SIGTERM"]);
    expect(await run.kill("already exited")).toBe(result);
  });

  it.each([false, true])("kills grandchildren (ignores SIGTERM: %s)", async (stubborn) => {
    const fixture = fileURLToPath(new URL("./fixtures/grandchild.mjs", import.meta.url));
    const { run, output } = launch("grandchild", {
      spec: { argv: [process.execPath, fixture, stubborn ? "stubborn" : "normal"], cwd: dir, env: {} },
    });
    await vi.waitFor(
      () => {
        expect(output("stdout")).toHaveLength(1);
      },
      { timeout: 900 },
    );
    const pid = Number(output("stdout")[0]);
    expect(pid).toBeGreaterThan(0);
    expect(exists(pid)).toBe(true);
    try {
      expect((await run.kill("stop tree")).status).toBe("killed");
      await vi.waitFor(
        () => {
          expect(exists(pid)).toBe(false);
        },
        { timeout: 900 },
      );
    } finally {
      if (exists(pid)) process.kill(pid, "SIGKILL");
    }
  });

  it("uses exactly the supplied environment, cwd and literal arguments", async () => {
    vi.stubEnv("FANOUT_TEST_SECRET", "synthetic-secret");
    const fixture = fileURLToPath(new URL("./fixtures/environment.mjs", import.meta.url));
    const env = { PATH: "/synthetic/path", ALLOWED: "yes" };
    const args = ["two words", "$(echo must-stay-literal)"];
    const { run, output } = launch("environment", {
      spec: { argv: [process.execPath, fixture, ...args], cwd: dir, env },
    });
    expect((await run.done).status).toBe("done");
    const observed: unknown = JSON.parse(output("stdout")[0] ?? "null");
    expect(observed).toMatchObject({ env, cwd: realpathSync(dir), args });
    expect(observed).toHaveProperty("env");
    if (typeof observed !== "object" || observed === null || !("env" in observed)) {
      throw new Error("Missing child environment");
    }
    const childEnv = observed.env;
    expect(childEnv).not.toHaveProperty("FANOUT_TEST_SECRET");
    // macOS may insert its own text-encoding variable during process initialization.
    expect(
      Object.keys(childEnv as Record<string, unknown>)
        .filter((key) => process.platform !== "darwin" || key !== "__CF_USER_TEXT_ENCODING")
        .sort(),
    ).toEqual(Object.keys(env).sort());
    expect(readFileSync(logPath, "utf8")).not.toContain("synthetic-secret");
  });

  it("assembles split chunks, CRLF and multibyte characters", async () => {
    const { run, output, onStarted } = launch("chunks");
    expect((await run.done).status).toBe("done");
    expect(output("stdout")).toEqual(["first", "second", "last🙂é"]);
    expect(output("stderr")).toEqual(["warning", "end"]);
    expect(onStarted).toHaveBeenCalledOnce();
  });

  it("bounds long lines in bytes and resumes at the next newline", async () => {
    const { run, output } = launch("long-lines", { maxLineBytes: 8 });
    expect((await run.done).status).toBe("done");
    expect(output("stdout")).toEqual([
      "12345678",
      "12345678 …[truncated]",
      "🙂🙂 …[truncated]",
      "xxxxxxxx …[truncated]",
      "short",
    ]);
    expect(output("stderr")).toEqual(["abcdefgh …[truncated]"]);
  });

  it("does not split a UTF-8 character at the truncation boundary", async () => {
    const { run, output } = launch("long-lines", { maxLineBytes: 5 });
    await run.done;
    expect(output("stdout")[2]).toBe("🙂 …[truncated]");
  });

  it("caps log payload once while continuing both callbacks", async () => {
    const { run, output } = launch("flood", { maxLogBytes: 35 });
    expect((await run.done).status).toBe("done");
    expect(output("stdout")).toEqual(Array.from({ length: 100 }, (_, i) => `line ${i}`));
    expect(output("stderr")).toEqual(["after log cap"]);
    const log = readFileSync(logPath, "utf8");
    const marker = "[log truncated at 35 bytes]\n";
    expect(log.endsWith(marker)).toBe(true);
    expect(log.split(marker)).toHaveLength(2);
    expect(Buffer.byteLength(log) - Buffer.byteLength(marker)).toBeLessThanOrEqual(35);
  });

  it("reports spawn errors through done without rejecting", async () => {
    const { run } = launch("lines", { spec: { argv: [join(dir, "missing")], cwd: dir, env: {} } });
    expect(run.pid).toBeUndefined();
    expect(await run.done).toMatchObject({
      status: "failed",
      exitCode: null,
      signal: null,
      startDetected: false,
    });
    expect((await run.done).error).toContain("ENOENT");
  });

  it("reports synchronous launch errors through done", async () => {
    const { run } = launch("lines", { spec: { argv: [""], cwd: dir, env: {} } });
    expect(await run.done).toMatchObject({ status: "failed", exitCode: null, startDetected: false });
    expect((await run.done).error).toBeTypeOf("string");
  });

  it("does not spawn if the log cannot be opened", async () => {
    const { run } = launch("sleep", { logPath: dir });
    expect(run.pid).toBeUndefined();
    expect(await run.done).toMatchObject({ status: "failed", exitCode: null, startDetected: false });
    expect((await run.done).error).toBeTypeOf("string");
  });

  it("contains callback errors and stops the child", async () => {
    const { run } = launch("sleep", {
      onLine: () => {
        throw new Error("consumer failed");
      },
    });
    expect(await run.done).toMatchObject({ status: "failed", error: "consumer failed" });
  });
});
