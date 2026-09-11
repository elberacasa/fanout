# Decisions

Architecture decision records, newest last. Each entry states the choice, the reason, and the consequences. Reverse a
decision by adding a new entry, never by editing an old one.

## 0001 · Subscriptions through official CLIs, not API keys (2026-09-11)

**Choice:** seats are the vendor CLIs a developer already has installed and signed in, driven through their official
non-interactive modes.

**Why:** people already pay for these subscriptions and run them one at a time. Keys add cost and a
credential-handling burden, and subscriptions are the differentiator.

**Consequences:**
- We depend on each CLI's flags and output formats, so every adapter needs a versioned manifest and contract tests.
- We must review each provider's terms before shipping its adapter.
- We never handle credentials.

## 0002 · Local-first daemon + web canvas, native later (2026-09-11)

**Choice:** a local Node daemon with an HTTP/WebSocket API, and a React + React Flow canvas served on localhost.
Tauri wraps it later.

**Why:** the fastest path to a Figma-like canvas that works everywhere. A native app first would slow iteration.

**Consequences:** the terminal companion and the native app become clients of the same API.

## 0003 · One append-only event ledger (2026-09-11)

**Choice:** everything the daemon does is an event in SQLite; state, usage, scorecards and replay are projections.

**Why:** trust, debuggability, replay and learning from history, all from one source.

**Consequences:** version the event schema from day one; never mutate history.

## 0004 · Isolation and review before merge (2026-09-11)

**Choice:** each editing run works in its own git worktree, auditors get read-only archives, agents never commit,
and merging requires a brain review, the checks and the user's approval.

**Why:** trust is the product. One bad unreviewed merge loses a user.

## 0005 · The brain talks to the daemon over MCP (2026-09-11)

**Choice:** the planner/reviewer interface is an MCP server exposed by the daemon.

**Why:** several agent CLIs can use MCP servers, so any seat can become the brain, and tools are cleaner than
parsing terminal output.

## 0006 · TypeScript monorepo (2026-09-11, to confirm in session 1)

**Choice:** pnpm workspaces, TypeScript strict, zod, vitest, Playwright.

**Why:** one language across the daemon and the UI, shared event types, `npx` install, and a large contributor pool.

## 0007 · The name (open)

"Fanout" is a working name, matching the owner's public `codex-fanout` skill. Before the first public release, check
availability (npm, GitHub, domain) and avoid vendor trademarks as the product name ("Claude", "Codex", "Gemini") and
names that collide with existing agent projects (e.g. CrewAI).

## 0008 · Claude Code is the lead; the product is a plugin plus a vendor-neutral daemon (2026-09-11)

**Choice:** the brain is the user's interactive Claude Code session. Fanout ships as a Claude Code plugin (skill,
commands, hooks, status line, MCP server config) on top of a local daemon that does all the mechanics. Amends 0002
(the editable canvas moves to P1; P0 has a read-only mission view) and narrows 0005 (MCP stays the interface, but P0
supports only Claude Code as the brain).

**Why:** the parallel-runner category is crowded (Conductor, Emdash, Parallel Code, …); the open space is the lead's
job, done where developers already work. Claude Code already has the lead's primitives (plan mode, background events
through Monitor, hooks, notifications). The interactive brain also stays outside headless billing. The owner chose
this on 2026-09-11.

**Consequences:** the daemon must not depend on Claude Code, so other brains can come later (P3). The plugin must stay
thin: correctness lives in tested daemon code. We depend on Claude Code's plugin, MCP and hook interfaces; pin and
test them like adapters.

## 0009 · Claude as a worker is opt-in (2026-09-11)

**Choice:** the default workers are other vendors' CLIs. Claude runs as a worker only when the user opts in, per
mission or per line.

**Why:** the lead already spends Claude quota on planning and review; the point is to put the other subscriptions to
work. It matches the owner's `codex-fanout` rule.

## 0010 · Any agent CLI through adapters; P0 covers what is verified on the owner's machine (2026-09-11)

**Choice:** any agent CLI with an official non-interactive mode can become a seat through one adapter folder. P0
ships Codex, Claude (opt-in), Kimi, Grok and Cursor (verified on the owner's machine on 2026-09-11); Gemini, Qwen and
OpenCode follow when installed and verified.

**Why:** the owner wants every CLI on their Mac to be usable, and "four vendors in one mission" is the product's
proof.

**Consequences:** the adapter kit must make a new CLI a small, well-tested change; each adapter still needs fixtures,
contract tests and a terms review before it ships.

## 0011 · The mission view is local only (2026-09-11)

**Choice:** the view is served by the daemon on `127.0.0.1` with a per-daemon token and an Origin check. It is never
published as a hosted page or a Claude artifact.

**Why:** the view shows code, diffs and prompts; non-negotiable 5 keeps them on the machine.

## 0012 · Track each seat's billing pool (2026-09-11)

**Choice:** every adapter manifest records which pool a seat bills against (subscription limits, separate credit,
API) and the date of its terms review; the UI shows it.

**Why:** vendors change how headless use is billed (Anthropic announced, then paused, a separate credit for
`claude -p` in June 2026). A policy change should be a manifest update, not a redesign.

## 0013 · The stack, confirmed (2026-09-11; confirms 0006)

**Choice:** pnpm workspaces, TypeScript 6.0 strict (plus `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`,
`erasableSyntaxOnly`), zod 4, vitest 5, ESLint 10 with typescript-eslint `strictTypeChecked`, Prettier. Node 22.13+
with the built-in `node:sqlite` for the ledger, wrapped behind our own `Ledger` class.

**Why:** Node 20 reached end of life in April 2026. `node:sqlite` needs no native build, so `npx` installs can't fail
compiling a driver. TypeScript 7 (the native port) is out, but typescript-eslint supports TypeScript below 6.1 only,
so we stay on 6.0 until it catches up.

**Consequences:** Node prints an ExperimentalWarning for `node:sqlite`; tests silence it and the CLI will filter only
that warning. Swapping to better-sqlite3 later touches one file.

## 0014 · The name: Fanout (2026-09-11; closes 0007)

**Choice:** the product is **Fanout**. The Claude Code command is `/fanout`, the CLI binary is `fanout`, the npm
package will be `fanout-cli` (the bare `fanout` name belongs to an unrelated 2022 package).

**Why:** the command is the product's front door and the first frame of the video: `/fanout add dark mode, CSV export
and fix the flaky test` says what happens. The owner delegated the choice.

**Consequences:** nothing is reserved until the owner approves publishing.

## 0015 · Minimum Node 22.18, and the adapter contract (2026-09-11; amends 0013)

**Choice:** the minimum Node is 22.18, where TypeScript type stripping is on by default, so `node src/cli.ts` runs
without a build step (the fake seat's CLI, dev scripts). `SeatAdapter` (`packages/core/src/adapter.ts`) is the
contract every CLI implements: `command()` returns the exact `LaunchSpec` (argv, cwd, the child's whole environment),
and `parse()` maps one stdout line to events plus signals (`session`, `limit`, `report`, `unparsed`) and never throws.

**Why:** fewer moving parts for dev tools; a stable contract before the first adapters are built in parallel.
