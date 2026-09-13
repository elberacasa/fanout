# Changelog

Notable changes, newest first. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the
project uses [semantic versioning](https://semver.org/spec/v2.0.0.html). Before `v1.0.0` the surface may change
between minor versions.

## [Unreleased]

Nothing yet.

## [0.6.0] — 2026-09-11

Fanout becomes usable from inside Claude Code.

### Added

- **The Claude Code plugin** (`plugin/`): `/fanout <goal>` plans and launches a mission, `/fanout:crew` shows the
  seats, `/fanout:watch` subscribes to the live feed. A skill carries the lead's judgment — when a fan-out is worth
  it, how to write a prompt an agent can follow, how to review what comes back — and hooks put the crew in front of
  you at the start of a session. Passes `claude plugin validate`.
- **MCP server** (`@fanout/mcp`): seven tools and no more — `seats`, `repo_overview`, `plan_check`, `launch`,
  `mission_status`, `run_diff`, `cancel_mission`. `launch` refuses a plan whose safety report has a blocking
  failure unless the user's own reason is passed as an override, and that override is recorded. Nothing merges
  here: `run_diff` reads the workspace itself and hands you the decision.
- **Mission runner** (`@fanout/daemon`): a plan becomes runs — each in its own worktree, in dependency order, never
  more at once than allowed. A line whose dependency failed is dropped with the reason rather than started
  hopefully, and `run.finished` carries the diff read from the workspace rather than the agent's account of it.
- **`fanout mcp`** (`@fanout/cli`): speaks MCP on stdin and stdout for Claude Code while running the daemon in the
  same process, so one process owns the ledger and the live feed has something to serve.
- **The ledger tells a listener** (`@fanout/core`) when an event is recorded, after it commits, so the live feed
  never shows something that could still be rolled back.

## [0.5.0] — 2026-09-11

The daemon and the command line: the first parts you can actually run.

### Added

- **Daemon API** (`@fanout/daemon`): HTTP for what is there now and a WebSocket for what happens next, bound to
  `127.0.0.1` only. Every request carries a token from a file only you can read, compared in constant time; a
  request arriving with a browser's `Origin` is refused before a handler sees it. Health is the one open endpoint,
  because it says nothing about you. A subscription can be narrowed to one mission or to the events a lead acts on,
  and a subscriber that joins mid-mission gets the replay first.
- **`fanout` CLI** (`@fanout/cli`): `status` asks every installed CLI who it is and whether it is signed in and says
  "unknown" when a CLI offers no way to ask; `daemon` runs the daemon and prints where it listens, where its token
  lives and the URL to subscribe to; `clean` removes the worktrees and throwaway branches a mission left behind and
  never touches your own. Everything lives in `~/.fanout`, and `FANOUT_HOME` moves it.

### Dependencies

- `ws`, because Node ships a WebSocket client but no server.

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

## 0.7.0 — 2026-09-13

The first published release. `npx fanout-cli demo` runs a whole mission on a machine with no accounts and nothing
configured: three simulated agents, three git worktrees, three real diffs, and a mission view on localhost.

- **On npm**, eight packages led by `fanout-cli`. Unscoped `fanout-*` rather than `@fanout/*` — the `fanout` org
  was taken. Published tarballs carry compiled JavaScript: Node refuses to strip types under `node_modules`, so
  shipping TypeScript was never possible (ADR 0021). The repository itself still has no build step.
- **Routing on limits.** A line whose seat has run out moves to another, and the reason is on the row that moved.
  A CLI that cannot report its own sign-in is kept when the plan named it and refused only as a fallback; a move
  carries the seat id and not the model.
- **A person approves their own merge.** `merge.approved` records how we know: `direct` when the daemon received
  the click itself, `relayed` when the lead reports a conversation (ADR 0020). `POST /approve` is the daemon's
  only write route, and it refuses a browser origin, a missing token, and anything not yet reviewed and checked.
- **The write scope is enforced, not merely reported.** A run that writes outside what its plan declared is
  refused at merge; widening it names each path and leaves an `Outside-scope:` trailer in the commit (ADR 0022).
- **Fanout built some of this.** Two Codex agents, one rework round each as resumed sessions, reviewed and proven
  through the gate, merged as `2d8f9fa` and `f1fcb44`.
