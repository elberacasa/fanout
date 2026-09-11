import { spawn, type ChildProcess } from "node:child_process";
import { closeSync, openSync, writeSync } from "node:fs";
import { StringDecoder } from "node:string_decoder";
import type { OutputStream, RunExit, RunHandle, SuperviseOptions } from "./types.ts";

export function supervise(options: SuperviseOptions): RunHandle {
  const began = performance.now();
  let resolveDone: ((result: RunExit) => void) | undefined;
  const done = new Promise<RunExit>((resolve) => {
    resolveDone = resolve;
  });
  let child: ChildProcess | undefined;
  let log: number | undefined;
  let logBytes = 0;
  let logTruncated = false;
  let startDetected = false;
  let settled = false;
  let closed = false;
  let exitCode: number | null = null;
  let signal: NodeJS.Signals | null = null;
  let stopping: "failed" | "killed" | "timeout" | undefined;
  let error: string | undefined;
  let startTimer: NodeJS.Timeout | undefined = undefined;
  let timeoutTimer: NodeJS.Timeout | undefined = undefined;
  let killTimer: NodeJS.Timeout | undefined;

  function clearDeadlines(): void {
    clearTimeout(startTimer);
    clearTimeout(timeoutTimer);
  }

  function finish(): void {
    if (settled) return;
    settled = true;
    clearDeadlines();
    clearTimeout(killTimer);
    if (log !== undefined) {
      try {
        closeSync(log);
      } catch (cause) {
        error ??= message(cause);
        stopping ??= "failed";
      }
      log = undefined;
    }
    resolveDone?.({
      status: stopping ?? (exitCode === 0 ? "done" : "failed"),
      exitCode,
      signal,
      startDetected,
      durationMs: performance.now() - began,
      ...(error === undefined ? {} : { error }),
    });
  }

  function signalGroup(nextSignal: NodeJS.Signals | 0): boolean {
    if (child?.pid === undefined) return false;
    try {
      process.kill(-child.pid, nextSignal);
      return true;
    } catch (cause) {
      if (!(cause instanceof Error && "code" in cause && cause.code === "ESRCH")) {
        error ??= message(cause);
      }
      return false;
    }
  }

  function stop(status: "failed" | "killed" | "timeout"): void {
    if (settled || stopping !== undefined) return;
    stopping = status;
    clearDeadlines();
    signalGroup("SIGTERM");
    // Keep escalation alive even if the group leader exits before its descendants.
    killTimer = setTimeout(() => {
      if (signalGroup(0)) signalGroup("SIGKILL");
      killTimer = undefined;
      if (closed) finish();
    }, options.killGraceMs);
  }

  function fail(cause: unknown): void {
    error ??= message(cause);
    stop("failed");
  }

  function writeLog(text: string): void {
    if (log === undefined) return;
    const bytes = Buffer.from(text);
    let offset = 0;
    while (offset < bytes.length) {
      offset += writeSync(log, bytes, offset, bytes.length - offset);
    }
  }

  function line(text: string, stream: OutputStream): void {
    try {
      if (!logTruncated) {
        const entry = `${stream === "stderr" ? "[stderr] " : ""}${text}\n`;
        const size = Buffer.byteLength(entry);
        if (logBytes + size <= options.maxLogBytes) {
          writeLog(entry);
          logBytes += size;
        } else {
          // Keep complete log lines; the single marker is metadata beyond the payload cap.
          logTruncated = true;
          writeLog(`[log truncated at ${options.maxLogBytes} bytes]\n`);
        }
      }
    } catch (cause) {
      fail(cause);
    }
    try {
      options.onLine(text, stream);
    } catch (cause) {
      fail(cause);
    }
  }

  const handle: RunHandle = {
    runId: options.runId,
    get pid() {
      return child?.pid;
    },
    done,
    kill() {
      stop("killed");
      return done;
    },
  };

  try {
    log = openSync(options.logPath, "a", 0o600);
    child = spawn(options.spec.argv[0], options.spec.argv.slice(1), {
      cwd: options.spec.cwd,
      env: { ...options.spec.env },
      stdio: ["ignore", "pipe", "pipe"],
      detached: true,
    });
  } catch (cause) {
    error = message(cause);
    stopping = "failed";
    finish();
    return handle;
  }

  startTimer = setTimeout(() => {
    error = `No stdout received within ${options.startTimeoutMs} ms`;
    stop("failed");
  }, options.startTimeoutMs);
  timeoutTimer = setTimeout(() => {
    stop("timeout");
  }, options.timeoutMs);

  const stdout = splitLines(options.maxLineBytes, (text) => {
    line(text, "stdout");
  });
  const stderr = splitLines(options.maxLineBytes, (text) => {
    line(text, "stderr");
  });
  child.stdout?.on("data", (chunk: Buffer) => {
    if (chunk.length > 0 && !startDetected && stopping === undefined) {
      startDetected = true;
      clearTimeout(startTimer);
      try {
        options.onStarted();
      } catch (cause) {
        fail(cause);
      }
    }
    stdout.push(chunk);
  });
  child.stderr?.on("data", (chunk: Buffer) => {
    stderr.push(chunk);
  });
  child.stdout?.on("error", fail);
  child.stderr?.on("error", fail);
  child.once("error", fail);
  child.once("exit", (code, exitSignal) => {
    exitCode = code;
    signal = exitSignal;
  });
  child.once("close", (code, exitSignal) => {
    closed = true;
    exitCode = child.pid === undefined ? null : code;
    signal = exitSignal;
    stdout.end();
    stderr.end();
    if (stopping === undefined || killTimer === undefined || !signalGroup(0)) finish();
  });
  return handle;
}

function message(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

/** Retain only the bounded prefix, even for an arbitrarily long unterminated line. */
function splitLines(limit: number, emit: (line: string) => void) {
  let parts: Buffer[] = [];
  let retained = 0;
  let length = 0;
  let lastByte: number | undefined;

  function append(bytes: Buffer): void {
    if (bytes.length === 0) return;
    lastByte = bytes[bytes.length - 1];
    length = Math.min(limit + 2, length + bytes.length);
    const keep = Math.min(bytes.length, Math.max(0, limit - retained));
    if (keep > 0) {
      parts.push(Buffer.from(bytes.subarray(0, keep)));
      retained += keep;
    }
  }

  function flush(newline: boolean): void {
    const size = length - (newline && lastByte === 13 ? 1 : 0);
    const prefix = Buffer.concat(parts, retained).subarray(0, size);
    const truncated = size > limit;
    const text = truncated ? new StringDecoder("utf8").write(prefix) : prefix.toString("utf8");
    parts = [];
    retained = 0;
    length = 0;
    lastByte = undefined;
    emit(`${text}${truncated ? " …[truncated]" : ""}`);
  }

  return {
    push(chunk: Buffer): void {
      let offset = 0;
      let newline = chunk.indexOf(10, offset);
      while (newline !== -1) {
        append(chunk.subarray(offset, newline));
        flush(true);
        offset = newline + 1;
        newline = chunk.indexOf(10, offset);
      }
      append(chunk.subarray(offset));
    },
    end(): void {
      if (length > 0) flush(false);
    },
  };
}
