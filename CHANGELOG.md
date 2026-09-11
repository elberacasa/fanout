# Changelog

Notable changes, newest first. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the
project uses [semantic versioning](https://semver.org/spec/v2.0.0.html). Before `v1.0.0` the surface may change
between minor versions.

## [Unreleased]

Nothing yet.

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
