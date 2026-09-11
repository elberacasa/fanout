# Status

## Resume here (2026-09-11, end of session 1)

- **Where we are:** P0 milestone 1 (Foundations) is **done**. `packages/core` holds the event, plan and scope schemas,
  plan validation, the append-only SQLite ledger and pure projections. `npm run check` is green: 107 tests.
- **Design:** Claude Code is the lead; Fanout is a Claude Code plugin plus a vendor-neutral local daemon; Claude as a
  worker is opt-in; any agent CLI becomes a seat through an adapter (DECISIONS 0008–0014). Name: Fanout. Stack:
  Node 22.13+, TypeScript 6.0, zod 4, vitest 5, node:sqlite.
- **Next:** milestone 2, the fake seat and the supervisor.
  1. Lead first (contract before fan-out): add `packages/core/src/adapter.ts` (`LaunchSpec`, `AdapterContext`,
     `SeatAdapter`, `ParseResult` with events and signals: `limit`, `report`, `session`, `unparsed`), the skeletons
     of `packages/daemon` (with `src/supervisor/types.ts`: `SuperviseOptions`, `RunHandle`, `RunExit`) and
     `packages/adapters/fake`, add `packages/adapters/*` to the workspace, raise the minimum Node to 22.18 (type
     stripping, so `node src/cli.ts` runs), `pnpm install`, commit.
  2. Launch the prepared prompts in `.fanout/prompts/` with the codex-fanout skill: `m2-supervisor`, `m2-fake-seat`
     (builders, one worktree each; link `node_modules` and each `packages/*/node_modules` into the worktree) and
     `m1-core-audit` (read-only archive). The owner asked to see the prompts before launch.
  3. Review, merge with `git apply -3`, glue the supervisor to the adapter in the daemon, record events in the ledger.
- **Open questions:** none blocking.
- **Owner's machine (verified 2026-09-11):** macOS 26.5 arm64, Node 25.6, pnpm 10.28. Agent CLIs: Claude Code
  2.1.269 (signed in, Max), Codex 0.154.0 (signed in, ChatGPT), Kimi Code 0.36.1, Grok Build 1.0.13, Cursor Agent
  2026.01.23 (not signed in). Details in `docs/ADAPTERS.md`.
- **Nothing is public yet.** Pushing to GitHub or publishing needs the owner's word.

## History

- 2026-09-11 · Session 1: design reset to Claude-Code-native (0008–0014); milestone 1 built (107 tests); milestone 2
  prompts prepared.
- 2026-09-11 · Foundation documents written (session 0).
