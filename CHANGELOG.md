# Changelog

Notable changes, newest first. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the
project uses [semantic versioning](https://semver.org/spec/v2.0.0.html). Before `v1.0.0` the surface may change
between minor versions.

## [Unreleased]

Nothing yet.

## [0.4.0] — 2026-09-11

Real seats: three agent CLIs driven for real, each parsed from a stream we actually recorded.

### Added

- **Adapter manifest** (`@fanout/core`): what an adapter declares about its CLI as data — supported versions, the
  exact non-interactive invocation, the safest modes, how to ask about sign-in, which pool it bills against, and
  when its vendor's terms were reviewed. A CLI outside its range is unsupported, never guessed at.
- **Codex seat** (`@fanout/adapter-codex`): `codex exec` with structured output, an auditor kept read-only and
  outside a git repository. 16 contract tests replay a recording of codex 0.154.0.
- **Grok seat** (`@fanout/adapter-grok`): the documented single-turn mode, an auditor held in plan mode. Its prose
  arrives in one-word pieces and it writes no report file, so the adapter assembles the report itself. 16 tests
  against a recording of grok 1.0.13.
- **Claude seat** (`@fanout/adapter-claude`), opt-in: `claude -p` with permission prompts denied rather than
  bypassed. It is the only seat that reports real quota windows. 15 tests against a recording of claude 2.1.269.
- **Detector** (`@fanout/daemon`): finds each CLI, reads its version, and asks it whether it is signed in through
  its own status command. It answers "unknown" rather than guessing, and stops at the version for a CLI outside the
  range its adapter was verified against.
- **Adapters can read stderr** and **report a quota window** (`@fanout/core`): Kimi puts a usage limit on stderr
  with nothing in its stream, and Claude reports how full each window is and when it resets.

### Notes

- **Kimi has no adapter yet.** The owner's account reached its monthly limit, so no successful run could be
  recorded, and we do not write a parser for a stream we have not seen.

## [0.3.0] — 2026-09-11

Isolation and the gate that decides whether anything runs.

### Added

- **Workspaces** (`@fanout/daemon`): a git worktree on a throwaway branch for every editing run, and an export with
  no `.git` for auditors, so an auditor cannot commit, switch branch or read history. Neither contains ignored
  files. A deny-list is checked against the base commit first, and a workspace is refused rather than handing an
  agent a tracked `.env` or private key. The diff is read from the workspace against the base commit — accurate even
  if an agent stages or commits — and every path written outside the line's declared scope is listed for review.
- **Safety gate** (`@fanout/daemon`): eight checks computed from the plan, the repository and the seats as detected,
  each naming the lines it concerns, plus the exact commands that would run. A command carrying a flag that hands
  over the machine never launches. A check that cannot be evaluated warns instead of passing quietly.
- **Git runner** (`@fanout/daemon`): every git call without a shell, with a closed environment and a timeout, so a
  path can never become an argument and a hung git cannot hang a mission.

### Changed

- **Safety reports carry their plan revision** (`@fanout/core`), and a projection refuses one that belongs to an
  older plan instead of showing it as current.
- **Scopes accept ordinary filenames** (`@fanout/core`): every character except `/` and control characters is
  literal, so `src/my file.ts`, `docs/notes (draft).md` and `app/[id]/page.tsx` can be written as scopes.

## [0.2.0] — 2026-09-11

The crew can run an agent safely and record everything it does.

### Added

- **Supervisor** (`@fanout/daemon`): launches one agent CLI with only an allowlisted environment, stdin closed, in
  its own process group. Start detection on the first byte of output, start and wall-clock timeouts, SIGTERM then
  SIGKILL reaching grandchildren, and both streams captured to a private log with a size cap and multibyte-safe line
  truncation.
- **Environment allowlist** (`@fanout/daemon`): agents receive PATH, HOME, locale, TMPDIR and the XDG paths. API
  keys, tokens and cloud credentials in the user's shell never reach them.
- **Run glue** (`@fanout/daemon`): ties an adapter, the supervisor and the ledger together, creates the run's private
  directories, and stops any run whose events cannot be recorded. Adapters may only report progress, tool calls and
  usage, and only for their own run.
- **Fake seat** (`@fanout/adapter-fake`): a deterministic simulated agent for the offline demo and for tests that
  need an agent without an account. Scenario-driven CLI (phases, tool calls with real file writes, usage, limits,
  hang) with its stream format defined once and a fixture recorded from the CLI itself.

### Fixed

- **Scope matching** (`@fanout/core`): a path such as `src/../private/key` counted as inside `src/**`, which would
  have let a run write outside its declared scope. Matching is now linear: two valid patterns could previously freeze
  validation entirely.
- **Projections** (`@fanout/core`): identifiers that collide with object properties (`constructor`) broke lookups;
  events arriving after a merge or drop brought a finished run back to life; usage could be charged to a seat other
  than the run's.
- **Ledger** (`@fanout/core`): a row whose indexed columns disagreed with its stored event was returned silently for
  the wrong mission; it is now refused as damage. `INSERT OR REPLACE` could overwrite a recorded event without
  triggering the delete guard.

## [0.1.0] — 2026-09-11

Foundations: the contract everything else is built on.

### Added

- **Event and plan schemas** (`@fanout/core`): every event validated on write and on read, versioned from day one.
  A safety report cannot claim to be fine while a blocking check failed, and a passing proof must name a test that
  failed on the old code.
- **Plan validation** (`@fanout/core`): duplicate ids, unknown and circular dependencies, read-only auditors, and
  overlapping write scopes between lines that can run at the same time.
- **Append-only ledger** (`@fanout/core`): SQLite with the database itself refusing to change or remove a recorded
  event, and refusing to open a ledger whose guards were removed or that a newer version wrote.
- **Projections** (`@fanout/core`): the crew, usage per seat, and each mission's plan, safety report, runs and
  routes, derived purely from events. Events that don't fit are kept as anomalies rather than crashing a view.
- **Seat adapter contract** (`@fanout/core`): how every agent CLI is driven and how its output becomes events.
