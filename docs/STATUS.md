# Status

## Resume here (2026-09-11, end of session 1)

- **Where we are:** P0 milestones 1–5 are **done**. `npm run check` is green: **354 tests** (22 files), and CI is
  green on macOS and Linux, Node 22 and 24.
  - `packages/core`: schemas (events, plan, scope, manifest), plan validation, the append-only ledger, projections,
    the `SeatAdapter` contract.
  - `packages/daemon`: supervisor, environment allowlist, run glue, workspaces, safety gate, detector, and the
    localhost API (HTTP + WebSocket, token, Origin check).
  - `packages/adapters`: `fake`, `codex`, `grok`, `claude` (opt-in) — each parser built from a recorded run.
  - `packages/cli`: `fanout status | daemon | clean | version | help`.
- **It runs.** `node packages/cli/src/cli.ts status` reports the real crew on this machine.
- **The repository is live and private:** https://github.com/elberacasa/fanout — Conventional Commits enforced by a
  hook and by CI, tags `v0.1.0` … `v0.5.0`, Dependabot on. Branch protection needs the repository to be public.
- **Open for contributors:** Kimi ([#4](https://github.com/elberacasa/fanout/issues/4)) and Cursor
  ([#5](https://github.com/elberacasa/fanout/issues/5)), each with the CLI's flags already verified and a
  seven-step walkthrough in `docs/ADAPTERS.md`.
- **Next:** milestone 6, the Claude Code plugin. This is the milestone that makes the product *itself* usable.
  1. Lead first: an MCP server (`fanout mcp`, stdio) exposing the lead's tools — `seats`, `repo_overview`,
     `propose_plan` (returns the safety report), `launch`, `run_status`, `run_diff`, `review`, `merge`, `drop`.
     It talks to the daemon over the localhost API, starting one if none is running.
  2. The plugin around it: the skill (the lead's judgment, trimmed from `codex-fanout`), `/fanout` commands, hooks
     (SessionStart crew summary, PreToolUse guard against committing unreviewed agent work, Stop warning about open
     runs), and a status line.
  3. The Monitor feed: `ws://127.0.0.1:<port>/events?for=lead` already exists and is what the lead subscribes to.
  4. Good fan-out for teammates once the tool shapes are committed: the status line script, the hook scripts, and an
     adversarial audit of the API's security model (read-only).
- **Crew method:** strongest model (gpt-6-astra, high) for foundation code and audits; budget models only for
  low-risk, easily redone work. Record each agent's model in the build log.
- **Owner's machine (verified 2026-09-11):** macOS 26.5 arm64, Node 25.6, pnpm 10.28. Claude Code 2.1.269 (signed
  in, Max), Codex 0.154.0 (signed in, ChatGPT), Grok Build 1.0.25 (no status command → unknown), Kimi Code 0.36.1
  (at its monthly limit), Cursor Agent 2026.01.23 (not signed in).
- **Still private.** Making the repository public, publishing to npm, or anything else outward-facing needs the
  owner's word.

## History

- 2026-09-11 · Session 1: design reset to Claude-Code-native (0008–0016); milestones 1–5 built (354 tests); three
  Codex agents plus an adversarial audit; the repository published privately with its history rewritten to standard;
  three agent CLIs driven for real; the daemon and CLI running on this machine.
- 2026-09-11 · Foundation documents written (session 0).
