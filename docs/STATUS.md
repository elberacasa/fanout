# Status

## Resume here (2026-09-11, end of session 1)

- **Where we are:** P0 milestones 1–4 are **done**. `npm run check` is green: **311 tests** (19 files), and CI is
  green on macOS and Linux, Node 22 and 24.
  - `packages/core`: event, plan and scope schemas, plan validation, the append-only ledger, projections, the
    `SeatAdapter` contract (with stderr parsing and quota signals) and the adapter manifest.
  - `packages/daemon`: supervisor, environment allowlist, run glue, workspaces, the safety gate, and the detector.
  - `packages/adapters`: `fake` (simulated), `codex`, `grok`, `claude` (opt-in) — each parser built from a stream
    recorded on a throwaway repository, with contract tests that replay it.
- **The repository is live and private:** https://github.com/elberacasa/fanout — Conventional Commits enforced by a
  hook and by CI, tags `v0.1.0` … `v0.4.0`, Dependabot on. Branch protection needs the repository to be public.
- **Kimi is waiting on quota, not on us.** On 2026-09-11 the account answered `403 … monthly usage limit`. When it
  refreshes: record a run (see "Recording a fixture" in `docs/ADAPTERS.md`), then write the parser. Do not guess one.
- **Next:** milestone 5, the daemon API and the `fanout` CLI.
  1. Lead first: the daemon process — open the ledger, hold the detector's crew, own the workspace manager and the
     safety gate, and expose HTTP + WebSocket on `127.0.0.1` with a per-daemon token and an Origin check
     (DECISIONS 0011). The WebSocket feed is what the lead's Monitor subscribes to.
  2. The `fanout` CLI: `daemon`, `status` (the crew, from the detector), `demo`, `clean`. `npx`-friendly.
  3. Good fan-out for teammates once the API shape is committed: the CLI's output formatting and an adversarial
     audit of the workspace, gate and adapters (read-only).
- **Crew method:** the strongest model (gpt-6-astra, high) for foundation code and audits; budget models only for
  low-risk, easily redone work. Record each agent's model in the build log.
- **Owner's machine (verified 2026-09-11):** macOS 26.5 arm64, Node 25.6, pnpm 10.28. Agent CLIs: Claude Code
  2.1.269 (signed in, Max), Codex 0.154.0 (signed in, ChatGPT), Kimi Code 0.36.1 (at its monthly limit), Grok Build
  1.0.13, Cursor Agent 2026.01.23 (not signed in). Details in `docs/ADAPTERS.md`.
- **Still private.** Making the repository public, publishing to npm, or anything else outward-facing needs the
  owner's word.

## History

- 2026-09-11 · Session 1: design reset to Claude-Code-native (0008–0016); milestones 1–4 built (311 tests); three
  Codex agents plus an adversarial audit; the repository published privately with its history rewritten to standard;
  three agent CLIs driven for real and parsed from recorded streams.
- 2026-09-11 · Foundation documents written (session 0).
