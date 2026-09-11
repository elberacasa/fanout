# Status

## Resume here (2026-09-11, end of session 1)

- **Where we are:** P0 milestones 1 and 2 are **done**. `npm run check` is green: **178 tests** (11 files).
  - `packages/core`: event, plan and scope schemas, plan validation, the append-only SQLite ledger, pure projections,
    and the `SeatAdapter` contract.
  - `packages/daemon`: the supervisor (isolated spawn, stdin closed, start detection, timeouts, process-group kill,
    capped log), the environment allowlist, and the run glue that records a run in the ledger.
  - `packages/adapters/fake`: the deterministic simulated agent (scenario-driven CLI, recorded fixture) and its
    adapter.
- **Design:** Claude Code is the lead; Fanout is a Claude Code plugin plus a vendor-neutral local daemon; Claude as a
  worker is opt-in; any agent CLI becomes a seat through an adapter (DECISIONS 0008–0015). Name: Fanout. Stack:
  Node 22.18+, TypeScript 6.0, zod 4, vitest 5, node:sqlite.
- **Next:** milestone 3, workspace + safety report.
  1. Lead first: the workspace module (a `git worktree` per editing run from the mission's base commit, a `git archive`
     copy for auditors, cleanup) and the deny-list (`.env*`, keys, credentials, gitignored files).
  2. The safety report the launch gate reads: scope overlap (the schema check already exists), secrets excluded,
     safest permission and sandbox mode per seat, network off where the CLI allows it, and a dry-run preview of the
     exact commands. While building it, settle two contract gaps listed in `docs/ARCHITECTURE.md`: tie
     `safety.report` to a plan revision, and decide how scopes express filenames with spaces or non-ASCII characters.
  3. Good fan-out for teammates once the lead has written the module's interface: the deny-list matcher with tests,
     and a second adversarial audit of the supervisor and run glue.
- **Crew method:** the strongest model (gpt-6-astra, high) for foundation code and audits; budget models
  (gpt-5.6-luna / terra) only for low-risk, easily redone work. Record each agent's model in the build log.
- **Owner's machine (verified 2026-09-11):** macOS 26.5 arm64, Node 25.6, pnpm 10.28. Agent CLIs: Claude Code
  2.1.269 (signed in, Max), Codex 0.154.0 (signed in, ChatGPT), Kimi Code 0.36.1, Grok Build 1.0.13, Cursor Agent
  2026.01.23 (not signed in). Details in `docs/ADAPTERS.md`.
- **Nothing is public yet.** Pushing to GitHub or publishing needs the owner's word.

## History

- 2026-09-11 · Session 1: design reset to Claude-Code-native (0008–0015); milestone 1 built (107 tests); milestone 2
  built with three Codex agents and an adversarial audit (178 tests).
- 2026-09-11 · Foundation documents written (session 0).
