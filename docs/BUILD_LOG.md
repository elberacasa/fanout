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
