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

## 0016 · A safety report belongs to a plan revision (2026-09-11; amends event schema v1)

**Choice:** `safety.report` carries the `planRevision` it describes. A projection keeps the report only when it
matches the mission's current plan; a report for an older revision is recorded as an anomaly and the mission stays
without a safety report. Scope patterns also gain the rest of the alphabet: every character except `/` and control
characters is literal, so `src/my file.ts`, `docs/notes (draft).md` and `app/[id]/page.tsx` can be written as scopes.

**Why:** the milestone 1 audit found that a report computed for an old plan could attach itself to a newer one, which
is the worst kind of failure for a gate: it looks green. The scope alphabet was the other half of the same problem —
a safety report cannot protect files it cannot name.

**Consequences:** the event schema version stays 1 because no ledger exists outside development; after the first
public release, a change of this shape needs a new version and an upgrade path. `*` and `?` are always wildcards,
with no escape: a file whose name truly contains one is covered by a scope ending in `**`.

## 0017 · P0 supports two seats deeply; the rest are community seats (2026-09-12; narrows ROADMAP P0)

**Choice:** P0 ships **Codex and Claude Code** as *supported* seats — driven deep, verified against real runs on
every version bump, and covered by the definition of done. Grok, Kimi and Cursor become **community** seats: their
adapters live in the tree and their contract tests keep running against recorded fixtures, but nothing about them
gates a release and we do not spend the owner's quota on them. The `fake` seat stays the **reference**
implementation. P0's done-criteria changes from "at least three vendors' CLIs as workers" to Claude Code leading
Codex, both deep, with the fake seat carrying the offline demo.

**Why:** every capability worth having is vendor-specific, so breadth forces the lowest common denominator.
Supporting two lets the merge gate use `codex exec resume` for real session continuation on rework instead of
re-pasting context, `codex exec review` for genuine second-vendor review (which was P1), and Claude Code's
`claude auth status --json` and real quota windows for routing on facts rather than estimates. The abstraction
already paid for this: a seat is one folder and nothing else in the daemon changes, so adopting another CLI later is
an addition, never a refactor.

**Consequences:** the multi-vendor claim must be stated as it is — two supported seats plus a kit — in the README,
`AGENTS.md` and `docs/ADAPTERS.md`. Two risks are accepted and mitigated. First, with only two real adapters the
`SeatAdapter` contract could quietly become "whatever Codex and Claude do"; the `fake` seat is deliberately unlike
either, and Grok's fixtures keep a third and fourth implementation honest at no cost. Second, Claude Code is already
the lead, so a Claude *worker* spends the same subscription window the lead is running in: Claude-as-worker stays
opt-in, and the safety report says whose quota a line will draw from. Lead-versus-worker contention becomes the
interesting case for milestone 9 rather than a smaller one.

## 0018 · Assign a run's session id; never fish for it (2026-09-12)

**Choice:** where a CLI lets us set the session identifier for a non-interactive run, Fanout generates the id and
passes it in, rather than parsing whichever line the CLI happens to announce it on. Verified on Claude Code:
`claude -p … --session-id <uuid>` is honoured, and every line of the resulting stream carries it. Resuming with
`--resume <id>` genuinely continues that conversation — a follow-up saying "the file you just created" resolved
correctly — and `--resume <id> --fork-session` inherits the context under a new id.

**Why:** rework is the merge gate's most valuable move, and it depends on being able to reach the session that wrote
a diff. Parsing the id out of a stream makes that ability contingent on the run behaving: Grok reports its session
only in its final line, so a run killed at a timeout — precisely the run most likely to need rework — leaves us with
no way back into it. An id we chose before launch is known even if the process dies in its first second.

**Consequences:** `{session}` becomes a launch-time placeholder, not only a resume-time one, for seats that support
assignment. Seats that do not (Codex today, as far as `--help` shows) keep the parsed `session` adapter signal, so
both paths must survive; the manifest says which applies rather than the daemon assuming. The id must be a fresh
UUID per run and must never be derived from anything about the repository or the user.
