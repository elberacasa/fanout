# Status

## Resume here (2026-09-12, session 1 ended at 98% context)

### Where we are

P0 milestones **1–6 are done**, tagged `v0.1.0` … `v0.6.0`. `npm run check` is green: **371 tests** (24 files).
CI green on macOS and Linux, Node 22 and 24. Repository: https://github.com/elberacasa/fanout (**private**).

| Package | What works |
|---|---|
| `@fanout/core` | Event, plan, scope and manifest schemas; plan validation; append-only ledger (with an on-append listener); projections; the `SeatAdapter` contract |
| `@fanout/daemon` | Supervisor, environment allowlist, run glue, workspaces, safety gate (8 checks), detector, mission runner, localhost API (HTTP + WebSocket, token, Origin check) |
| `@fanout/adapters/*` | `fake`, `codex`, `grok`, `claude` (opt-in) — each parser built from a recorded real run |
| `@fanout/mcp` | Seven tools: `seats`, `repo_overview`, `plan_check`, `launch`, `mission_status`, `run_diff`, `cancel_mission`. No merge tool, and a test asserts its absence |
| `@fanout/cli` | `fanout status | daemon | clean | mcp | version | help` |
| `plugin/` | `/fanout`, `/fanout:crew`, `/fanout:watch`, the lead's skill, hooks. Passes `claude plugin validate` |

### The first real mission (2026-09-12)

Fanout ran a real mission on a throwaway repo: **a landing page for Fanout**, three lines, three agents in three
worktrees, driven through the real MCP server exactly as Claude Code drives it.

- Script: `packages/cli/landing-mission.dev.ts` (untracked, deliberately: it has absolute scratch paths). It builds
  the plan, calls `plan_check`, `launch`, polls `mission_status`, then `run_diff` per run.
- Target repo: `<scratch>/landing`; mission home `<scratch>/landing-home` (ledger, runs, workspaces).
- Mission id `a-landing-page-for-fanout-68cf`, base commit `df7511d`.
- Result at hand-off: `page-1` (codex) **done**, `copy-1` (codex) **done**, `styles-1` (grok) still running after
  ~11 minutes. The finished work is in `<scratch>/landing-home/workspaces/<runId>/`.

**Two findings from it, both worth fixing:**

1. **Grok's phase never advances.** Our adapter only moves the phase on a tool call, and Grok streams its thinking
   as `text`/`thought` deltas that we ignore, so `mission_status` shows "reading" for minutes while it is working.
   The display is dishonest by omission. Fix in `packages/adapters/grok/src/index.ts`: treat sustained text as
   progress (a `detail` on `run.progress`), or map the first tool call to "coding" and text deltas to a phase the
   person watching can believe.
2. **Grok is slower than Codex** on the same task (minutes versus ~3), which is fine but should be visible: the
   mission view and `mission_status` should show elapsed time per run.

### Next: milestone 7, the merge gate

The promise the whole product rests on. In order:

1. **Lead first (contract):** `review` (verdict + notes, recorded), `checks` (run the project's own commands against
   the applied diff), `proof` (a bug fix's new test must fail on the old code), `merge` (`git apply -3` plus new
   files; conflicts reported, never forced), `drop`, and rework (notes back to the same worktree, max 2).
2. **Settle the contract gaps** listed in `docs/ARCHITECTURE.md` for this milestone: an approval event so a replay
   shows who authorised a change, and the revision each check and proof ran against.
3. **Then** the MCP tools for them and the plugin's review flow.
4. **Good fan-out for teammates** once the shapes are committed: the checks runner, and an adversarial audit of the
   gate itself (read-only) — it is the most dangerous code in the project.

### Also queued

- **Presentation.** The owner wants the live output to look good (screenshot 2026-09-12): `mission_status` and the
  CLI should render a crew/mission view worth watching — elapsed time, phase, files, a progress bar per line. That
  is P0 · 8 (mission view), and the CLI can get a decent version sooner.
- **Landing page.** If the mission's output is good, it can move into the repo as `site/` and later become the
  public page. Judge it by eye first.
- **Open for contributors:** Kimi ([#4](https://github.com/elberacasa/fanout/issues/4)) and Cursor
  ([#5](https://github.com/elberacasa/fanout/issues/5)).

### Owner's machine (verified 2026-09-11/12)

macOS 26.5 arm64, Node 25.6, pnpm 10.28. Claude Code 2.1.269 (signed in, Max), Codex 0.154.0 (signed in, ChatGPT),
Grok Build 1.0.25 (no status command → unknown), Kimi Code 0.36.1 (at its monthly limit), Cursor Agent 2026.01.23
(not signed in).

### How to run it

```sh
cd /Users/alejandroberacasa/fanout
pnpm --filter @fanout/cli link --global   # puts `fanout` on PATH
fanout status
claude --plugin-dir "$PWD/plugin"          # then /fanout <goal>
```

**Still private.** Making the repository public, publishing to npm, or anything else outward-facing needs the
owner's word.

## History

- 2026-09-12 · First real mission: three agents, three worktrees, a landing page. Two honesty bugs found in how
  progress is shown.
- 2026-09-11 · Session 1: design reset to Claude-Code-native (0008–0016); milestones 1–6 built (371 tests); three
  Codex agents plus an adversarial audit; repository published privately with its history rewritten to standard;
  three agent CLIs driven for real; daemon, CLI, MCP server and plugin running on this machine.
- 2026-09-11 · Foundation documents written (session 0).
