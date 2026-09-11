# Status

## Resume here (2026-09-11, end of session 1)

- **Where we are:** P0 milestones 1, 2 and 3 are **done**. `npm run check` is green: **221 tests** (14 files), and CI
  is green on macOS and Linux, Node 22 and 24.
  - `packages/core`: event, plan and scope schemas, plan validation, the append-only ledger, pure projections, the
    `SeatAdapter` contract.
  - `packages/daemon`: the supervisor, the environment allowlist, the run glue, **workspaces** (worktree per editing
    run, export for auditors, deny-list, diff collection, cleanup) and the **safety gate** (eight checks plus the
    dry run).
  - `packages/adapters/fake`: the deterministic simulated agent and its adapter.
- **The repository is live and private:** https://github.com/elberacasa/fanout — Conventional Commits enforced by a
  hook and by CI, tags `v0.1.0`, `v0.2.0`, `v0.3.0`, Dependabot on. Branch protection needs the repository to be
  public (GitHub Free); add it then.
- **Next:** milestone 4, real seats. In order:
  1. **Codex adapter** (`packages/adapters/codex`): manifest (version range, flags, billing pool, terms review),
     `command()` from `codex exec --json -C <workdir> -s <sandbox> -o <report>` with stdin closed, `parse()` for its
     JSONL stream, fixtures recorded from a real run (scrubbed), contract tests. The lead writes the manifest shape
     and the first adapter; the rest can fan out.
  2. **Claude adapter** (opt-in worker): `claude -p --output-format stream-json`, permission mode chosen explicitly.
  3. **Kimi and Grok** adapters, same shape; **Cursor** when the owner signs in.
  4. A detector that finds installed CLIs, their versions and sign-in state through each CLI's own status command.
- **Good fan-out for teammates** once the manifest shape is committed: one adapter per agent (disjoint folders), and
  an adversarial audit of the supervisor, run glue, workspace and safety gate (read-only).
- **Crew method:** the strongest model (gpt-6-astra, high) for foundation code and audits; budget models
  (gpt-5.6-luna / terra) only for low-risk, easily redone work. Record each agent's model in the build log.
- **Owner's machine (verified 2026-09-11):** macOS 26.5 arm64, Node 25.6, pnpm 10.28. Agent CLIs: Claude Code
  2.1.269 (signed in, Max), Codex 0.154.0 (signed in, ChatGPT), Kimi Code 0.36.1, Grok Build 1.0.13, Cursor Agent
  2026.01.23 (not signed in). Details in `docs/ADAPTERS.md`.
- **Still private.** Making the repository public, publishing to npm, or anything else outward-facing needs the
  owner's word.

## History

- 2026-09-11 · Session 1: design reset to Claude-Code-native (0008–0016); milestones 1–3 built (221 tests); three
  Codex agents plus an adversarial audit; the repository published privately with its history rewritten to standard.
- 2026-09-11 · Foundation documents written (session 0).
