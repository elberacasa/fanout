# Status

## Resume here (2026-09-11, end of session 1)

- **Where we are:** P0 milestones 1–6 are **done**. `npm run check` is green: **371 tests** (24 files), and CI is
  green on macOS and Linux, Node 22 and 24. Fanout can be used from inside Claude Code: `/fanout <goal>` plans a
  mission, runs it across the installed CLIs in isolated worktrees, and brings the diffs back for review.
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
- **Next:** milestone 7, the merge gate. This is the promise the whole product rests on.
  1. Lead first: `review` (a verdict with notes, recorded), `checks` (run the project's own commands against the
     applied diff), `proof` (a bug fix's new test must fail on the old code), then `merge` — `git apply -3` plus new
     files, conflicts reported and never forced — and `drop`. Rework sends the notes back to the same worktree,
     twice at most.
  2. The settled contract gaps for this milestone are in `docs/ARCHITECTURE.md`: an approval event so a replay shows
     who authorised a change, and the revision each check and proof ran against.
  3. Then the MCP tools for them, and the plugin's review flow.
  4. Good fan-out for teammates once the shapes are committed: the checks runner, and an adversarial audit of the
     gate (read-only) — it is the most dangerous code in the project.
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
