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
