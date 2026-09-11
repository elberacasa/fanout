<!--
Builder · P0 milestone 2 · the fake seat. Worktree from main after the lead's contract commit.
Launch: codex exec -C "$S/m2-fake-seat" -s workspace-write -o "$S/m2-fake-seat-report.md" "$(cat .fanout/prompts/m2-fake-seat.md)" < /dev/null > "$S/m2-fake-seat.log" 2>&1
-->
This repository is Fanout: a local daemon that runs coding-agent CLIs as parallel workers under a lead. You are
building the **fake seat**: a deterministic simulated agent CLI plus its adapter. It powers the offline demo and every
test that needs an agent without an account.

Read first: AGENTS.md, docs/ADAPTERS.md (the contract and contract tests), packages/core/src/adapter.ts (the
`SeatAdapter` contract you implement), packages/core/src/schema/events.ts (the events you produce),
packages/adapters/fake/package.json, and packages/core/test/projections.test.ts (copy its test style).

TASK
1. **Scenario** (`packages/adapters/fake/src/scenario.ts`): a zod schema for what the fake agent does, for example
   `{ "steps": [ { "phase": "reading", "delayMs": 300 }, { "tool": "edit", "summary": "add csv writer",
   "write": { "src/api/csv.ts": "export const csv = …" } }, { "usage": 2 }, { "limit": "usage limit reached" } ],
   "report": "Added the endpoint.", "exitCode": 0, "hang": false }`. Step kinds: phase, tool (with optional file
   writes), usage (messages), limit (a usage-limit message, then exit 2), sleep. A `speed` multiplier scales every
   delay (the demo uses 0.2).
2. **CLI** (`packages/adapters/fake/src/cli.ts`, run as `node src/cli.ts --scenario-json '<json>' --report <path>
   <prompt>`): validates the scenario (exit 64 with a clear stderr message if invalid), then plays it: prints one
   JSON object per line on stdout (its own stream format; document it in a comment), really writes the files relative
   to its cwd, writes the report file, and exits with `exitCode`. It refuses any write path that is absolute or
   escapes the cwd (`..`), exiting 65. `hang: true` sleeps forever after the steps. Same scenario → byte-identical
   stdout.
3. **Adapter** (`packages/adapters/fake/src/index.ts`): `createFakeAdapter({ scenarioFor(line) })` returns a
   `SeatAdapter` whose `command()` builds the argv above (with `process.execPath`) and whose `parse()` maps each
   stdout line to `ParseResult`: phases → `run.progress`, tools → `run.tool` (files as written), usage →
   `run.usage` with `estimated: false`, limit → a `limit` signal, the final line → a `report` signal. A non-JSON or
   unknown line returns an `unparsed` signal; `parse()` never throws.
4. **Contract test** as in ADAPTERS.md: record the stdout of one representative scenario into
   `packages/adapters/fake/fixtures/basic.jsonl`, and test that `parse()` over the fixture yields exactly the expected
   events and signals. Also test: determinism (two runs, identical stdout), real file writes in a temp dir, path
   escape refused (exit 65), invalid scenario (exit 64), limit step (signal and exit 2), speed scaling. Launch the CLI
   in tests with `node:child_process` `spawn` and stdin `"ignore"`. Keep each test under 3 seconds.

HARD RULES
- Touch only `packages/adapters/fake/src/**`, `packages/adapters/fake/test/**`, `packages/adapters/fake/fixtures/**`.
  Do not edit `packages/core/**`, any package.json, or the lockfile. No new dependencies.
- No randomness and no wall-clock values in the stdout stream (determinism).
- Events you produce must pass `FanoutEvent` validation from `@fanout/core`; add a test that checks it.
- TypeScript strict as configured; erasable syntax only (no enums, no parameter properties); no `any`.
- Keep green: `pnpm typecheck` and `pnpm test`. (`pnpm lint` too if your sandbox can run it.)
- Do not commit and do not create branches.

FINAL MESSAGE
What you changed (files) and why, the stdout line format you chose, what you deliberately left alone, and the test
counts. Say plainly if your sandbox could not run a check.
