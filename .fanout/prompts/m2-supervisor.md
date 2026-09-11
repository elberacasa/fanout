<!--
Builder · P0 milestone 2 · the supervisor. Worktree from main after the lead's contract commit.
Launch: codex exec -C "$S/m2-supervisor" -s workspace-write -o "$S/m2-supervisor-report.md" "$(cat .fanout/prompts/m2-supervisor.md)" < /dev/null > "$S/m2-supervisor.log" 2>&1
-->
This repository is Fanout: a local daemon that runs coding-agent CLIs (Codex, Kimi, Grok, …) as parallel workers
under a lead. You are building the **supervisor**: the code that launches one agent CLI process safely and watches it.

Read first: AGENTS.md, docs/ARCHITECTURE.md (sections "Overview" and "Safety, in depth"),
packages/core/src/adapter.ts (the contract; `LaunchSpec`), packages/daemon/package.json, and
packages/core/test/ledger.test.ts (copy its test style: vitest, temp dirs, explicit assertions).

TASK
1. In `packages/daemon/src/supervisor/supervise.ts`, implement `supervise(options: SuperviseOptions): RunHandle`
   exactly as declared in `packages/daemon/src/supervisor/types.ts` (already written by the lead; do not change it).
   - Spawn `argv[0]` with `argv.slice(1)`, `cwd`, and **only** the environment in `spec.env`: never inherit
     `process.env`. Example: with `FANOUT_TEST_SECRET=x` set in the parent and `env: { PATH }`, the child must not see
     `FANOUT_TEST_SECRET`.
   - **stdin is closed** (`stdio: ["ignore", "pipe", "pipe"]`). A child that reads stdin gets EOF at once and must not
     hang.
   - Start the child in its own process group (`detached: true`) so a kill reaches its children too. Do not `unref()`.
   - **Start detection:** `onStarted()` fires once, on the first byte of stdout. If nothing arrives within
     `startTimeoutMs`, kill the run and finish with `{ status: "failed", startDetected: false }`.
   - **Lines:** split stdout and stderr into lines (handle chunks split mid-line, `\r\n`, and a final line without a
     newline); call `onLine(line, "stdout" | "stderr")` for each, in order per stream. Truncate any line longer than
     `maxLineBytes`, adding ` …[truncated]`.
   - **Log capture:** append both streams to `logPath` (create with mode 600; prefix stderr lines with `[stderr] `).
     Stop writing after `maxLogBytes`, writing one final `[log truncated at N bytes]` line; `onLine` keeps firing.
   - **Timeout:** after `timeoutMs` of wall clock, kill and finish with `status: "timeout"`.
   - **Kill:** `handle.kill(reason)` sends SIGTERM to the process group, then SIGKILL after `killGraceMs` if it is
     still alive; resolves when the process has exited. `status: "killed"`. Calling it twice is safe.
   - **Exit:** `handle.done` resolves (never rejects) with `{ status, exitCode, signal, startDetected, durationMs }`:
     exit 0 → `done`; non-zero → `failed`; our kill → `killed`; our timeout → `timeout`. A spawn error (for example
     ENOENT) resolves `failed` with `exitCode: null` and the error message in `error`.
2. Tests in `packages/daemon/test/supervise.test.ts`, using tiny Node scripts you add under
   `packages/daemon/test/fixtures/` (plain `.mjs`, launched with `process.execPath`): one per behaviour above:
   prints lines and exits 0; exits 3; reads stdin (must finish, not hang); prints nothing (start timeout); sleeps
   forever (overall timeout); ignores SIGTERM (SIGKILL after grace); spawns a grandchild that sleeps (the grandchild is
   gone after kill: check with `process.kill(pid, 0)`); prints the environment (no inherited secret); splits output
   across chunks without newlines; writes more than `maxLogBytes`. Keep every test under 3 seconds with small timeouts.

HARD RULES
- Touch only `packages/daemon/src/supervisor/supervise.ts`, `packages/daemon/test/**`. Do not edit
  `types.ts`, `packages/core/**`, any package.json, or the lockfile. No new dependencies.
- Never inherit or log the parent's environment. Never use `shell: true`.
- TypeScript strict as configured; no `any`, no non-null assertions, no `@ts-ignore`.
- Keep green: `pnpm typecheck` and `pnpm test`. (`pnpm lint` too if your sandbox can run it.)
- Do not commit and do not create branches.

FINAL MESSAGE
What you changed (files) and why, what you deliberately left alone, and the test counts. Say plainly if your sandbox
could not run a check, and which process-group or signal behaviours you could not observe.
