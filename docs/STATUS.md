# Status

## Resume here (2026-09-12, session 2)

### Where we are

P0 milestones **1–6 are done**, tagged `v0.1.0` … `v0.6.0`. `npm run check` is green: **410 tests** (25 files).
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

**Two findings from it. The second is fixed; the first is now a community-seat bug.**

1. **Grok's phase never advances** — the adapter only moves the phase on a tool call, while Grok streams its
   thinking as `text`/`thought` deltas we ignore. Still true, but Grok is a community seat now, so this is no longer
   on the critical path. Fix in `packages/adapters/grok/src/index.ts` when someone wants it.
2. ~~**No elapsed time, so slow looked identical to hung**~~ — **fixed** (`891c3ab`, `b7ed2c8`, `bdd2352`).
   `mission_status` and the CLI now show elapsed time and mark a working run that has said nothing for a minute as
   quiet. The landing mission would have rendered like this, which is the whole point:

   ```text
   a-landing-page-for-fanout-68cf · running · 2 running · 1 done
     ✓ page-1    codex  done     ▪▪▫▫ coding    3m 19s  +57 −2
     ● styles-1  grok   running  ▪▫▫▫ reading  11m 09s  quiet 7m 27s
     ● copy-1    codex  running  ▪▪▪▫ testing  11m 07s  quiet 7m 32s
   ```

### Scope narrowed (2026-09-12, ADR 0017)

P0 supports **Codex and Claude Code** deeply; Grok, Kimi and Cursor are **community** seats — adapters and fixtures
stay and keep passing, nothing about them gates a release, and **we never spend the owner's cheap subscriptions on
our own source tree**. The landing-page mission was the last Grok use and its output is discarded: it was a test, not
a design. The finding it produced survives as a review rule (below).

Probing the CLIs for capability data found three things worth the narrowing, all verified from `--help`:
`codex exec resume` (rework as real session continuation), `codex exec review` (second-vendor review, was P1),
`codex exec fork` (best-of-N later), plus `claude auth status --json` → `subscriptionType` and `grok usage`.
⚠️ That Claude probe also returns the owner's email and org id: read two fields, discard the rest, scrub the fixture.

### Next: finish 4b, then milestone 7

**4b · capability profiles — half done.** Manifests now declare a `tier` and four `capabilities` (resume, fork,
review, plan), each `null` when unverified. What remains, in order:

1. **Run the plan probe behind its allowlist.** `capabilities.plan.keep` names the only fields the daemon may keep
   from `claude auth status --json`; the schema proves `planField` is one of them, but **no code reads the probe
   yet, so the allowlist protects nothing today**. The detector must filter against `keep` before anything reaches
   the ledger, a log or a projection, with a test feeding it a response that carries an email and an org id.
2. **Verify Claude's resume, fork and review** by recording real runs; they are `null` on purpose until then.
3. **Seat posture** — `preferred · normal · sparing · off` per seat in `seats.json` under `FANOUT_HOME`, defaults
   from what was detected, shown by `fanout status`, and asked in-session the first time a mission would spend a
   sparing seat. Every value shows where it came from: detected, observed, or set by you.

### Then: milestone 7, the merge gate

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
- **The interface rule** (from the landing mission). Codex wrote `.feature-card`/`.hero-actions`; Grok styled
  `.feature`/`.wrap`. Where the prompt named a class both agents used it and the page is good; everywhere else it is
  unstyled. **When two lines must interlock, the shared identifiers are the contract**: the plan enumerates them and
  review verifies both sides. Belongs in milestone 7, not in a stylesheet.
- **Open for contributors:** Kimi ([#4](https://github.com/elberacasa/fanout/issues/4)) and Cursor
  ([#5](https://github.com/elberacasa/fanout/issues/5)) — community tier, not a waiting room.

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

- 2026-09-12 · Session 2: scope narrowed to two supported seats (ADR 0017); run timing, the quiet signal and one
  shared renderer for every surface; capability profiles in the manifest with a privacy allowlist. 410 tests.
- 2026-09-12 · First real mission: three agents, three worktrees, a landing page. Two honesty bugs found in how
  progress is shown. The page itself was a test and is discarded; its lesson became the interface rule.
- 2026-09-11 · Session 1: design reset to Claude-Code-native (0008–0016); milestones 1–6 built (371 tests); three
  Codex agents plus an adversarial audit; repository published privately with its history rewritten to standard;
  three agent CLIs driven for real; daemon, CLI, MCP server and plugin running on this machine.
- 2026-09-11 · Foundation documents written (session 0).
