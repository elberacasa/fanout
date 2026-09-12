# Status

## The road to P0 done

The one table to read first. P0 is done when a developer can install Fanout, run a real mission on their own
repository, and merge it through the gate — and when a stranger can see that happen in sixty seconds without an
account. Everything below is what stands between here and that.

| # | What | State | Done when |
|---|---|---|---|
| 1–6 | Foundations, seats, daemon, CLI, plugin | ✅ | tagged `v0.1.0`–`v0.6.0` |
| 4b | Capability profiles | ✅ | resume, fork, review and plan recorded from real runs, not `--help` |
| 7 | Merge gate | ✅ | review, rework, checks, proof, approval, `git apply -3` — run on real work through the gate itself |
| 8 | Mission view | ✅ | live, with the review queue, the gate's own reasons, reroutes, and a person's own approval — `f9263b1` |
| 9 | Routing on limits | ✅ | a seat hits its limit mid-mission, work moves, the reason is on screen — `afcbfdc`, `41a8bec` |
| 10 | Demo, video, npm | 🔨 | `fanout demo` ✅ · a 30-second video · `npx fanout-cli` works on a clean machine |

**Debts, logged and unpaid.** Small, real, and each one is how a future bug gets in:

- [x] ~~`pre-push` does not check lockfile drift~~ — `e2540f6`, written by a Codex agent, reworked once, merged
      through the gate.
- [x] ~~No test that every manifest field has a consumer~~ — `66de242`, same route.
- [ ] Grok's phase never advances (community seat, so it gates nothing).
- [x] ~~The mission view shows the review queue but cannot merge from it~~ — a person now approves from the page
      itself (`f9263b1`), which is the half that had to stop going through an agent. The merge stays a tool call
      on purpose: the commit message must follow the repository's own convention, and the lead writes that.

**What "robust" means here**, so it is not a feeling:

1. Every promise in `AGENTS.md` has a test that fails when the promise is broken — not a test that passes when it
   is kept. Mutation-test anything that guards money, secrets or the repository.
2. Nothing claims to be verified that was not. "CI green" is written from a run someone looked at; a check that
   did not run is never a pass; an unknown is never a yes.
3. The failure paths are the product. A refusal explains itself in the words of someone who has to act on it.
4. Anything that can be enforced structurally is, rather than remembered — one spawn list, one git helper, one
   renderer. Four rules were re-implemented wrongly in a single day; that is the cost of remembering.

## Resume here (2026-09-12, session 2)

### Where we are

P0 milestones **1–9 are done**, tagged `v0.1.0` … `v0.6.0`. `npm run check` is green locally: **715 tests**
(42 files). Repository: https://github.com/elberacasa/fanout (**public**).

**Only #10 is left**: the 30-second video, and `npx fanout-cli` working on a clean machine.

The repository is **public** since 2026-09-12, which is also how CI came back: Actions is free for public
repositories, and every job before that was refused before it started by a billing hold on the private one.

> Worth remembering: this file claimed "CI green on macOS and Linux" for an entire session during which no job had
> started. Nobody checked. Write it only from a run you have looked at.

| Package | What works |
|---|---|
| `@fanout/core` | Event, plan, scope and manifest schemas; plan validation; append-only ledger (with an on-append listener); projections; the `SeatAdapter` contract |
| `@fanout/daemon` | Supervisor, environment allowlist, run glue, workspaces, safety gate (8 checks), detector, mission runner, localhost API (HTTP + WebSocket, token, Origin check) |
| `@fanout/adapters/*` | `fake`, `codex`, `grok`, `claude` (opt-in) — each parser built from a recorded real run |
| `@fanout/mcp` | Thirteen tools, including `check_claims` and the gate's `merge_run`, which refuses anything `mergeReadiness` has not cleared |
| `@fanout/cli` | `fanout status \| seat \| check \| review \| owed \| daemon \| clean \| mcp \| version \| help` |
| `plugin/` | `/fanout`, `/fanout:crew`, `/fanout:watch`, the lead's skill, hooks. **Zero install** — runs the CLI out of the checkout via `${CLAUDE_PLUGIN_ROOT}`. Passes `claude plugin validate` |

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

### The thing that changed this session: the claim loop

Fanout was guarding the wrong code. It reviewed what agents produced in worktrees, while most of the code in a
Claude Code session is written by the lead and read by nobody else. The loop now is:

```text
claim  →  refuted  →  failing test  →  fix  →  checked again  →  confirmed
```

`check_claims` (MCP tool) and `fanout check` (terminal) put falsifiable claims in front of a cold reader — another
vendor's CLI, holding only the diff, with no idea why it was written. The asymmetry is not model quality: the lead
knows why its code is right, so its code looks right. A reader with no context is differently placed, and that is
cheap to buy three claims at a time.

**Everything bends one way.** A claim is `confirmed` only when the reader said so explicitly; a missing line, a
drifted format or a reader that contradicts itself leaves it `unclear`, never a pass. The Stop hook repeats a
refuted claim, with its reason, until it is dealt with.

**What it caught in the lead's own code today:** a signed-out seat reported as ready (shipped), detection that
could hang forever, a command spending a seat the owner had switched off, silence reported as a clean review, and
four escalating symlink escapes ending in Node's own `realpathSync` folding `..` lexically while resolving. See
`docs/BUILD_LOG.md`.

**And its limit, learned the same day:** the last refutation of the session was correct and **no code changed** —
the belief was wrong, not the guard. A refutation says a belief was false, not which of the two to fix.

### Next: finish 4b, then milestone 7

**4b · capability profiles — done**, except one carried item. Manifests declare a `tier` and four `capabilities`
(resume, fork, review, plan), each `null` when unverified:

1. ~~**Run the plan probe behind its allowlist**~~ — done. The detector filters through `keepAllowed` at the moment
   of reading, so the fields it must not keep never exist. Verified against the real CLI: `fanout status` shows
   `max (detected)` and a grep of the whole output finds no address, org id or home path.
2. ~~**Verify Claude's resume, fork and review**~~ — done from real runs. Resume and fork work on both seats;
   Claude has no review command, so that stays `null`. The better find was `--session-id`, which lets us choose a
   run's identity before launch instead of fishing it out of a stream (ADR 0018).
3. **Left open:** Grok's phase never advancing (community seat), and a contract test asserting that every manifest
   field has a consumer — three times this session a rule written as data was not read by new code.
4. ~~**Seat posture**~~ — done: `fanout seat <id> <preferred|normal|sparing|off> [why]`, honoured by every command
   that spends a subscription, and a policy file that cannot be read refuses the write rather than discarding it.

### Milestone 7, the merge gate — done

Five tools, in order, each recording the revision it judged:

```text
run_diff  →  review_run  →  run_checks  →  prove_fix  →  ask the user  →  merge_run
```

`merge_run` refuses unless review, checks, proof and approval all named the **same** diff, which is why they are
separate tools: one that reviewed and merged could skip its own gate. It applies with `git apply -3`, never
forces, and rolls a conflict all the way back — a half-applied merge is worse than a refused one. Proof checks out
the old code and copies **only** the run's tests onto it: they must fail there, or they do not test what broke.

**What is left of it:** rework. `run.session` now records the conversation each run was, so resuming it is
possible; nothing yet does. A `rework` verdict is recorded and then sits there.

### Also done since: the demo and the view

- **`fanout demo`** — a whole mission with no accounts: real worktrees, real safety gate, real ledger, real diffs,
  simulated agents. The one thing it cannot do honestly (a second vendor's verdicts) is written rather than read
  and labelled `simulated` through the event, the projection and the screen.
- **The mission view** — one HTML file, no framework, no dependencies (ADR 0019), served on localhost. Ticking
  clocks from real stamps, a quiet marker, refuted claims at the top, and a red bar when the daemon cannot be
  reached, because a stale picture must never pass for a current one.

**Good fan-out for teammates** once the gate's shapes are committed: the checks runner, and an adversarial audit of
the gate itself (read-only) — it is the most dangerous code in the project. The two audits this session found real
bugs in the lead's own work every time.

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
