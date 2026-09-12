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

## 0019 · The mission view is one file, with no build and no framework (2026-09-12; amends ARCHITECTURE)

**Choice:** the mission view is a single self-contained HTML page served by the daemon on `127.0.0.1` — no React,
no bundler, no npm dependencies, no build step. It reads a JSON snapshot from the daemon and redraws. The earlier
plan (React, a design system, a component library) is dropped.

**Why:** three reasons, in order of weight.

First, **this page renders your private source code**, and every dependency it carries is something that could read
that. A view with zero dependencies has a supply chain of exactly one file that a person can read in a sitting;
that is a security property, not a matter of taste, and it is the same argument that made the ledger refuse to
rewrite its own history rather than promising not to.

Second, the project's whole shape is already "no build step" — Node runs our TypeScript directly since 0015, the
CLI is `node cli.ts`, the plugin runs out of a checkout. A UI toolchain would be the only thing in the repository
that needs compiling, and `fanout demo` — the thing that has to work on a stranger's machine in sixty seconds —
would inherit it.

Third, what this view actually does is small: lanes, elapsed times, phases, a diff and a list of claims with their
verdicts. That is not a framework's worth of problem.

**Consequences:** no component library, so shared vocabulary lives in CSS custom properties and small functions
rather than in a design system; we accept that. If the view later grows a plan-editing canvas (P1), this decision
is worth revisiting on its own merits rather than by default. The page is never hosted and never published as an
artifact, which was already true and matters more now that it is trivially portable.

## 0020 · An approval records how we know it happened (2026-09-12)

**Choice:** `merge.approved` by a person carries `via: "direct" | "relayed"`. `direct` means the daemon received
the click itself, over loopback, with its own token, from the mission view it served. `relayed` means the lead
called `merge_run` and quoted the user in `approvedBy`. The daemon grows one write route, `POST /approve`, and the
mission view grows one button — the only control on the page.

**Why:** the fourth non-negotiable says nothing merges without the user's approval, and until now that was a
convention rather than a property. `merge_run`'s description tells the lead to ask the user first and quote the
answer; nothing checked that it had. A language model that skipped the asking wrote a byte-identical event, and
the ledger — whose whole purpose is to answer "who authorised this?" months later — could not tell the two apart.

Recording the provenance is cheaper and more honest than trying to verify the relayed case, which cannot be
verified: we have no access to the conversation, and an agent's account of it is exactly the kind of evidence this
project refuses everywhere else. So we keep both, and stop pretending they are the same fact.

**Consequences:** the gate still accepts either, because a policy may pre-approve and a lead-relayed yes is usually
a real one; what changes is that an auditor can tell. The route approves and never merges: applying a diff needs a
commit message in the repository's own convention, which the lead writes, so the daemon never touches the user's
tree. Approving requires everything *except* the approval to be satisfied already (`blocksApproval`), so the
strongest evidence in the ledger can never land on a diff nobody reviewed. Events written before this decision have
no `via`; read them as `relayed`.

## 0021 · Published packages ship compiled JavaScript (2026-09-12; amends 0015)

**Choice:** the repository still has no build step — Node runs our TypeScript directly, the CLI is `node cli.ts`,
the plugin runs out of a checkout (0015). What changes is that `npm pack` and `npm publish` compile to `dist/`
first, through a `prepack` script, and the published packages point at that JavaScript via `publishConfig`.
Development is untouched: the workspace still imports `./src/index.ts`.

**Why:** not preference. **Node refuses to strip types from any file under `node_modules`** and throws
`ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING`. A package of `.ts` files fails on the first import on every machine
that installs it, so `npx fanout-cli` — the whole of milestone 10 — is impossible without compiling. Verified by
building the smallest possible reproduction rather than by reading about it.

`publishConfig` rather than changing `exports` outright, because a package that points at `dist` is a package
nobody can work on without building first, and that is the cost 0015 was avoiding.

**Consequences:** a published tarball is a different artifact from the source, which means it has its own ways of
being wrong — and all three of the first ones were invisible from a checkout and passed `npm run check` while
broken:

1. runtime files the compiler ignores and `files` does not ship (the adapter manifests, the mission view);
2. a path built as a string, which the compiler cannot rewrite — `./cli.ts` beside a `cli.js`, which killed all
   three demo agents on the first spawn;
3. a version written by hand that no longer matched the package naming it (two of them, disagreeing).

So `npm run verify:pack` packs every package, installs into an empty directory, and runs the demo end to end. It is
the only check in the repository that tests the *package* rather than the source, and it is the one that has to
pass before anything is published.

## 0022 · A plan's write scope is enforced at merge, not merely reported (2026-09-12)

**Choice:** `mergeRun` refuses any file the plan's write scope did not grant. A lead who wants one anyway names
each path in `allowOutsideScope`, and those paths are written into the commit as an `Outside-scope:` trailer.

**Why:** the scope was already computed. `collect` worked out what each run had written outside its declared
scope, and the only thing that ever happened to that list was being printed in one line of `run_diff`'s prose.
Nothing in `mergeReadiness` or `mergeRun` looked at it. So a run could write anywhere in its worktree — a CI
workflow, a lockfile, a hook — and the gate would apply it, provided the lead did not happen to read that line.

The safety report shows the user those scopes before anything launches, and the user approves on that basis. A
scope that is shown and then not enforced is worse than no scope, because it buys trust it does not pay for.

Found by running a real mission on this repository: both agents wrote to `docs/BUILD_LOG.md`, which neither had
been granted, and the gate was ready to merge both.

**Consequences:** widening is deliberate rather than forbidden, because sometimes it is right — the lead's own
prompt asked one agent for an export the plan had forgotten to grant, which is exactly how this was found.
Naming each path means a lead cannot wave through a file it has not looked at, and the trailer means an override
is still visible to whoever reads the history a year later. A plan whose scope forgets a file now costs a rework
round, which is the right price for the lead getting it wrong.

`AGENTS.md` now tells teammates to stay inside their scope including docs, and tells the lead to put a doc in a
line's scope when it wants that doc written — by one line only.
