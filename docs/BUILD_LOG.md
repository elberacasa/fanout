# Build log

The public record of a crew at work. Each session adds an entry, newest first. Keep it honest and short.
Never include private data or secrets.

## Entry format

```text
### YYYY-MM-DD · <milestone> · session N
Lead: Claude Code (<model>) · Teammates: <n> Codex agents (<model>)
Built:
- <what>: by <lead | codex:<agent-name>> · prompt: .fanout/prompts/<file>.md · review changed: <what and why>
Verified by the lead: <checks run and results, e.g. typecheck ok · 142 tests pass · demo green>
Could not verify: <anything, or "nothing">
Next: <the next step>
```

---

### 2026-09-12 · Scope narrowed; honest progress; capability profiles · session 2

Lead: Claude Code (Opus 5) · Teammates: codex (gpt-6-astra, high) × 1

Built:
- **Scope narrowed to two supported seats** (ADR 0017): Codex and Claude Code driven deep; Grok, Kimi and Cursor
  become community seats whose fixtures keep passing but gate nothing. Propagated to the roadmap, README, vision,
  product, adapters and status. Decided after probing the installed CLIs showed that everything worth having is
  vendor-specific: `codex exec resume` (rework as real session continuation), `codex exec review` (second-vendor
  review, previously P1), `codex exec fork` (best-of-N later), `claude auth status --json` → `subscriptionType`.
  New standing rule in AGENTS.md: build this project on the owner's expensive seats only; never spend a cheap
  subscription on our own tree.
- **Run timing and the quiet signal** (`@fanout/core`): by the lead. `RunView` gained `queuedAt`, `startedAt`,
  `endedAt` and `updatedAt`; `elapsedMs` and `silentMs` compute against the caller's clock so a finished run's
  duration never changes while a running one grows. 7 tests, failing first.
- **One renderer for every surface** (`core/src/format/`): by the lead. `mission_status` and the CLI now share it,
  so the chat and the terminal can never disagree. The phase bar shows which named phase a run reported, never how
  complete it is. 11 tests, failing first.
- **Capability profiles in the manifest**: by codex (prompt `agent-capabilities.md`), reviewed by the lead.
  `tier` plus four nullable `capabilities` (resume, fork, review, plan). The plan probe carries a `keep` allowlist
  and the schema proves `planField` is one of it. 21 tests, the agent reported all failing first.

Verified by the lead: `npm run check` green, **410 tests** (25 files), run 11 consecutive times across the session.
The agent's diff read line by line before merging; it invented nothing and said so explicitly.

Changed in review:
- Removed the agent's `fake` manifest test row. My prompt claimed `packages/adapters/fake/manifest.json` exists; it
  does not, and the agent correctly refused to invent one rather than guessing. `docs/ADAPTERS.md` now says the fake
  seat is the one seat with no manifest.
- Updated two inline manifest fixtures (`daemon/test/detector.test.ts`, `mcp/test/mcp.test.ts`) that my prompt had
  fenced off as out of scope; the agent flagged the contradiction instead of working around it.
- Fixed a real bug my own formatter tests caught: `silentMs` reported a **queued** run as quiet for as long as it
  waited in the queue, which would have raised an alarm about the scheduler doing its job. Only a run that has
  started and not ended can be silent.

Could not verify: CI on GitHub (not pushed at the time of writing). The agent could not run `npm run typecheck` or
`npm run test` in its sandbox (zod resolution and a Vite cache `EPERM`); the lead ran both.

Honest note: one `npm run check` failed 2 fake-seat CLI tests mid-session and **never reproduced** in 11 subsequent
runs. The leading hypothesis is stderr ordering — those tests assert stderr starts with `fake seat: `, and Node's
SQLite `ExperimentalWarning` precedes it whenever `NODE_OPTIONS=--disable-warning=ExperimentalWarning` is missing,
which is what happens if the suite is run with `npx vitest` instead of `npm run test`. Not proven, not fixed, and
recorded here rather than dismissed.

Not done: the `keep` allowlist is declared but **nothing enforces it yet** — no code runs the plan probe, so it is a
promise on paper, not a working control. Recorded as a contract gap in `docs/ARCHITECTURE.md`.

Next: run the plan probe behind the allowlist (with a test feeding it an email and an org id), seat posture, then
milestone 7, the merge gate.

### 2026-09-11 · P0 milestone 6, The Claude Code plugin · session 1 (continued)

Lead: Claude Code (Opus 5) · Teammates: none (the tool surface and what it refuses to do stay with the lead)

Built:
- **The mission runner**: a plan becomes runs in dependency order, each in its own worktree, never more at once than
  allowed, with a failed dependency dropping its dependents by reason rather than hope.
- **The MCP server**: seven tools and no more. `launch` refuses a plan the gate blocks unless the user's own words
  are passed as an override, which is recorded with the mission. There is no merge tool at all, and a test asserts
  its absence: the surface is a promise, not a convenience.
- **The plugin**: `/fanout`, `/fanout:crew`, `/fanout:watch`, the lead's skill, and hooks. `claude plugin validate`
  passes.
- **`fanout mcp`**: MCP on stdio plus the daemon in one process, so one process owns the ledger and the live feed
  has something to serve. Everything it prints goes to stderr, because stdout belongs to the protocol.

Verified beyond the tests: JSON-RPC spoken to the real `fanout mcp` over a pipe — it initialises, lists its seven
tools, writes `~/.fanout/daemon.json` (mode 600) and reports the feed URL on stderr.

The commit hook rejected the MCP server's own commit because `mcp` was not a known scope. That is the hook working:
an unknown scope is more likely a typo than a new package. The standard was widened deliberately, in its own commit.

Verified by the lead: typecheck ok · lint ok · **371 tests pass** (24 files) · plugin validated · MCP spoken over a
real pipe · CI green on macOS and Linux, Node 22 and 24.
Could not verify: the plugin inside a live Claude Code session (the owner installs it; the package is not published,
so `fanout` must be linked onto PATH first).
Next: milestone 7, the merge gate — review, the project's checks, proof that a fix fails on the old code, and the
user's approval before `git apply -3`.

### 2026-09-11 · P0 milestone 5, Daemon API + CLI · session 1 (continued)

Lead: Claude Code (Opus 5) · Teammates: none (the API's security model and the CLI's voice stay with the lead)

Built:
- **The daemon's door**: HTTP for the present, a WebSocket for what happens next, on `127.0.0.1` only, with a token
  file only the owner can read, constant-time comparison, and a refusal for anything arriving with a browser's
  Origin. The subscription can be narrowed to one mission or to the events a lead acts on, and replays before it
  goes live. New dependency: `ws` (Node ships a WebSocket client, not a server).
- **The `fanout` CLI**: `status`, `daemon`, `clean`, `version`, `help`.
- **Kimi and Cursor opened as contributions** ([#4](https://github.com/elberacasa/fanout/issues/4),
  [#5](https://github.com/elberacasa/fanout/issues/5)) with everything already verified about each CLI, plus a
  seven-step walkthrough and the bar a seat must meet to merge.

Found by running it for real, not by tests: `fanout status` on the owner's machine reported Grok at **1.0.25**, an
auto-update since its fixture was recorded at 1.0.13 — which the manifest's version range covers, and which is why
manifests declare ranges. `fanout clean` failed at first because git reports resolved paths (`/private/var/…`) while
`FANOUT_HOME` was the symlinked form (`/var/…`), so it removed nothing and then could not delete the branch.

Caught by Dependabot, not by us: the `ws` version was pinned from memory at 8.19.0, which carries a high-severity
denial of service and a medium-severity memory disclosure, both fixed in 8.21.0. It is a runtime dependency, so it
would have shipped. **Check a version against the registry before pinning it**, the same way a CLI's flags are
verified before an adapter trusts them.

Verified by the lead: typecheck ok · lint ok · **354 tests pass** (22 files) · `fanout status` and `fanout help` run
against the real machine · CI green on macOS and Linux, Node 22 and 24.
Could not verify: the daemon under a second concurrent client; `fanout clean` on Windows.
Next: milestone 6, the Claude Code plugin — the MCP tools, the skill, the commands, the hooks and the status line.

### 2026-09-11 · P0 milestone 4, Real seats · session 1 (continued)

Lead: Claude Code (Opus 5) · Teammates: none (each adapter needed a recording only the owner's machine could make)

Built:
- **Adapter manifest** and the **detector**: what a CLI declares about itself, and how the crew finds it, reads its
  version and asks it — through its own status command — whether it is signed in. It answers "unknown" rather than
  guessing, and never reads a credential file.
- **Three seats, each parsed from a real recorded run** on a throwaway repository, scrubbed: Codex 0.154.0,
  Grok Build 1.0.13, Claude Code 2.1.269 (opt-in). 47 contract tests replay those recordings.

What recording taught us that `--help` could not, and each of which changed the code:
- Codex reports **absolute paths** and hides a usage limit inside an ordinary `error` item.
- Grok streams prose in **one-word pieces**, writes no report file, and names its session only in its last line.
- Kimi puts a usage limit on **stderr with a non-zero exit** and nothing in its stream, so `SeatAdapter` gained an
  optional `parseStderr`; a daemon reading only stdout would have called that a plain failure.
- Claude reports **real quota windows** (how full, when they reset), so `AdapterSignal` gained a `quota` kind. Its
  init line also carries the owner's memory paths, skills and slash commands, which the scrub removes.

**Kimi has no adapter.** Its account answered `403 … monthly usage limit for this billing cycle`, so there is no
successful run to record. We did not retry (working around a limit is a non-negotiable) and did not guess a parser
from `--help`.

Verified by the lead: typecheck ok · lint ok · **311 tests pass** (19 files) · CI green on macOS and Linux,
Node 22 and 24 · the privacy scrub checked by grepping each fixture for the owner's home path, account name and
project paths.
Could not verify: Kimi's stream; Cursor (not signed in).
Next: milestone 5, the daemon API and the `fanout` CLI.

### 2026-09-11 · P0 milestone 3, Workspace + safety report · session 1 (continued)

Lead: Claude Code (Opus 5) · Teammates: none (isolation and the launch gate stay with the lead)

Built:
- **The repository went public-ready and private on GitHub** (`elberacasa/fanout`): Conventional Commits enforced by
  a dependency-free hook and by CI, a pre-push hook that refuses to push a red tree, README with badges and an
  honest status table, contributing guide, security policy with our real limits, code of conduct, changelog, issue
  forms, PR checklist, Dependabot. The 21 existing commits were rewritten into the standard before the first push,
  and tagged `v0.1.0` and `v0.2.0`.
- **Workspaces**: a worktree per editing run, an export with no `.git` for auditors, a deny-list checked against the
  base commit, the diff read from the workspace, and cleanup that survives a crash. 12 tests drive real git.
- **The safety gate**: eight checks, each naming the lines it concerns, plus the exact commands that would run.
  20 tests, including one that tries to slip a bad plan past every check at once.
- **Two contract gaps settled** from the milestone 1 audit: a safety report now carries its plan revision (a stale
  one is refused), and scopes accept ordinary filenames (spaces, parentheses, non-ASCII, `app/[id]/page.tsx`).

Reviewed by the lead, in the lead's own work: `collect` diffed against the index, so an agent that staged or
committed would have been under-reported; it now diffs against the base commit, with a test that fails on the old
behaviour. CI caught what local runs could not: the commit-standard job rejected Dependabot's own capitalised
subjects, so bots are exempt and the rule stays strict for people and agents.

Verified by the lead: typecheck ok · lint ok · **221 tests pass** (14 files) · every commit checked on its own ·
CI green on macOS and Linux, Node 22 and 24.
Could not verify: branch protection (GitHub Free does not allow rulesets on private repositories; to be added when
the repository goes public).
Next: milestone 4, real seats — the Codex adapter first, with recorded fixtures and contract tests.

### 2026-09-11 · P0 milestone 2, Fake seat + supervisor · session 1 (continued)

Lead: Claude Code (Opus 5) · Teammates: 3 Codex agents via codex-fanout

Built:
- **Supervisor** (`packages/daemon/src/supervisor/supervise.ts`, 21 tests, 13 `.mjs` fixtures): by
  codex (gpt-6-astra, effort high) · prompt: `.fanout/prompts/m2-supervisor.md` · review changed: `kill(reason)`
  discarded the reason; it is now reported in `RunExit.error`. Everything else merged as written: no inherited
  environment, stdin closed, detached process group, SIGTERM then SIGKILL, log mode 600 with a byte cap,
  multibyte-safe line truncation.
- **Fake seat** (`packages/adapters/fake`): by codex (gpt-5.6-luna, effort medium) · prompt:
  `.fanout/prompts/m2-fake-seat.md` · review changed: **substantially rewritten**. Its own tests failed 3 of 5 when
  the lead ran them (its sandbox could not run vitest); report paths outside the worktree were rejected (every daemon
  run would have exited 65); `hang` exited instead of hanging; `parse()` trusted unvalidated JSON. The lead moved the
  stream format into one zod schema shared by CLI and adapter, switched to `parseArgs` with the prompt after `--`,
  renamed `speed` to `timeScale`, and recorded the fixture from the real CLI with a test that proves it.
- **Adversarial audit of the core** (read-only archive): by codex (gpt-6-astra, effort high) · prompt:
  `.fanout/prompts/m1-core-audit.md` · found 6 real bugs, all fixed by the lead with a failing test first:
  `pathInScope` accepted `src/../private/key`; two valid patterns froze the matcher (a backtracking regex and
  un-memoized recursion — the hang blocked the event loop so hard that vitest could not even time out); the valid id
  `constructor` broke projection lookups; events after a merge or drop resurrected a run; usage could be charged to
  another seat; a row whose routing columns disagreed with its body was returned silently. Its contract gaps are now
  in `docs/ARCHITECTURE.md`.
- **Environment allowlist and run glue** (`packages/daemon/src/env.ts`, `run.ts`): by the lead. Agents get only
  PATH, HOME, locale, TMPDIR and XDG paths. Adapters may only report progress, tools and usage for their own run;
  anything else is refused and surfaced. If the ledger cannot record an event, the run is stopped.

Process note: the supervisor and audit first ran on cheaper models (gpt-5.6-terra / luna). The owner asked for the
strongest model on foundation code; that work was discarded and both were relaunched on gpt-6-astra.

Verified by the lead: typecheck ok · lint ok · **178 tests pass** (11 files) · each commit checked on its own with
`git rebase -x`. The end-to-end test drives the real fake-seat CLI through the real supervisor into a real ledger:
full run, usage limit, hang stopped by the timeout, manual kill.
Could not verify: CI on GitHub (not pushed); Node 22 locally (this machine runs Node 25; CI covers 22 and 24).
Next: milestone 3, workspace + safety report.

### 2026-09-11 · P0 milestone 1, Foundations · session 1

Lead: Claude Code (Opus 5) · Teammates: none yet (milestone 1 is the contract; the lead builds it)

Built:
- Design reset with the owner: competitive research, crew check on the owner's machine (Codex, Claude, Kimi, Grok,
  Cursor verified from `--help` and status commands), Claude Code as the lead (DECISIONS 0008–0014): by the lead.
- Tooling: pnpm workspace, TypeScript 6.0 strict, ESLint strictTypeChecked, Prettier, vitest, `npm run check`, CI
  file (not pushed): by the lead.
- `packages/core`: event, plan and scope schemas (zod), plan validation (cycles, dependencies, read-only auditors,
  overlapping parallel write scopes), the append-only SQLite ledger, pure projections: by the lead.
- Self-review fix: `INSERT OR REPLACE` could overwrite a recorded event without firing the DELETE guard. Added a
  guard trigger; the new test was shown failing on the old code first.
- Prepared, not launched: `.fanout/prompts/m2-supervisor.md`, `.fanout/prompts/m2-fake-seat.md` (builders) and
  `.fanout/prompts/m1-core-audit.md` (an adversarial read-only audit of the core).

Verified by the lead: typecheck ok · lint ok · 107 tests pass (6 files) · every commit checked on its own with
`git rebase -x`.
Could not verify: CI on GitHub (not pushed); Node 22 locally (the machine has Node 25; CI covers 22 and 24).
Honest note: the docs commit `89516e9` has a wrong time in its title (18:05; it was about 17:35). Commit times now
come from `date`.
Next: the owner approves the milestone 2 fan-out; the lead commits the adapter and supervisor contracts, then
launches the three Codex agents.

### 2026-09-11 · Foundation · session 0

Lead: Claude Code (Opus) · Teammates: none yet

Built:
- The foundation documents (README, AGENTS/CLAUDE rules, vision, product, architecture, adapters contract, roadmap,
  playbook, decisions, status, kickoff): by the lead, from a design conversation with the owner.
- The `codex-fanout` skill copied into `.claude/skills/`. It was proven in another project, where Codex agents ran
  audits, a simulator, two UI rebuilds and several logic passes in parallel under Claude's review.

Verified by the lead: documents cross-checked against each other; no code yet.
Could not verify: the CLI flags in ADAPTERS.md (session 1 verifies them on the owner's machine).
Next: session 1, P0 milestone 1 (see KICKOFF.md).
