# Roadmap

Build only the current phase. New ideas go to "Later" at the bottom.

## P0 · Claude leads, the crew builds (target: 4–5 weeks)

**Goal:** from Claude Code with the Fanout plugin, a developer asks for a mission; Claude plans it, fans it out to
the other agent CLIs on the machine in isolated worktrees, the developer watches it live in the mission view, and
every diff passes review, checks and proof before the developer approves the merge. Plus an offline demo anyone can
try with no accounts, and a 30-second video that makes people want it.

**Two seats, deeply** (ADR 0017). P0 supports **Codex** and **Claude Code**, driven far enough to use what each CLI
actually offers: session resume for rework, Codex's own `review` for second-vendor review, Claude's real quota
windows for routing. Grok, Kimi and Cursor are community seats — their adapters and fixtures stay in the tree and
keep passing, but they gate nothing. A seat is one folder, so adopting another CLI later is an addition.

Milestones, in order, each with tests green:

1. **Foundations:** pnpm monorepo, TypeScript strict, `npm run check`, CI; the event and plan schemas (zod); the
   ledger (append-only SQLite) with projections.
2. **Fake seat + supervisor:** a deterministic simulated agent (scriptable: phases, tool calls, diffs, failures,
   limits). The supervisor handles launch with stdin closed, start detection, timeouts, kill and log capture.
3. **Workspace + safety report:** worktrees and archives, the deny-list, scope-overlap validation, the dry-run
   command preview.
4. **Real seats:** the adapter kit plus Codex (default worker) and Claude (opt-in worker) — manifest, `detect`,
   `command`, `parse`, recorded fixtures, contract tests, terms reviewed. Grok shipped alongside them and is kept as
   a community seat; Kimi and Cursor stay open for contributors.
   **4b · Capability profiles:** what each supported CLI can be *told*, as data the lead can reason over — plan
   detection where the CLI reports it, session resume, its own review command, usage probes, model tiers and
   observed throughput. Recorded from real runs, never from `--help` alone.
5. **Daemon API + CLI:** HTTP, WebSocket (with the lead feed), the localhost token, and `fanout` (`daemon`, `demo`,
   `status`, `clean`).
6. **The Claude Code plugin:** the MCP server and tools, the skill, `/fanout` commands, hooks, the status line, the
   Monitor event feed, approvals and notifications.
7. **Merge gate:** review → checks → proof of fix → approval → `git apply -3` plus new files; rework (max 2, as a
   resumed session, not a re-pasted prompt) and drop; dependent lines start from the new commit; the mission summary.
   Second-vendor review via the worker CLI's own review command. The interface check: when two lines must interlock,
   the plan names the shared identifiers and review verifies both sides used them.
8. **Mission view:** live lanes, phase bars, tool ticker, diff peek, review queue, approve and kill, keyboard-first.
   It must look excellent.
9. **Routing v1:** per-seat concurrency caps, route-on-limit with the reason shown, usage real where a CLI reports
   it, otherwise estimated and labelled. Including lead-versus-worker contention: a Claude worker draws on the same
   window the lead is running in, and the plan says so before it launches.
10. **Demo + video + README:** `fanout demo` (offline, simulated seats, under 60 s, replayable), the 30-second video
    (see PRODUCT.md), and a README that sells it in 10 seconds.

**P0 is done when:** the offline demo runs on a clean machine with no accounts; a real mission on a sample repo, with
Claude Code leading **Codex and an opt-in Claude worker**, goes plan → safety → launch → watch → review → proof →
merge → verify, with a rework round done as a resumed session and a limit reroute visible; the video is recorded;
every milestone is tested; and the build log shows the crew's work.

## P1 · Smarter crew

**Done (2026-09-13): a mission that outlives its session.** The runner lives inside the session's MCP server today, so
closing a terminal kills the crew mid-flight and loses the work — see ADR 0024 for why that was a defensible
default and why it stops being one. Move the runner into `fanout daemon`, which is already long-lived, and have
the MCP server drive it over the local API. Done: a mission survives the session that
started it, a second terminal can watch it, and the lead that comes back finds its diffs waiting. What is left
of it is the lead's own convenience — nothing yet tells a returning session "you have work waiting" beyond the
`owed` hook, and `fanout status` is the only way to find a mission started somewhere else.

Then: plan editing in the mission view (the canvas: + New line, prompt cards, dependency arrows), steering and pause,
scorecards per seat and repo, full replay, and promoting community seats to supported as their capability profiles
are recorded: Grok and Kimi first, then Gemini, Qwen and OpenCode as they are installed and verified.

## P2 · Best of N

Tournament mode (the same line to N seats; the best passing diff wins, the loss costs are logged), routing learned
from scorecards, mission templates ("add a feature", "harden tests", "audit and fix"), plan diffs.

## P3 · Other brains and sharing

Codex or Gemini as the lead through the same MCP tools, a native wrapper, shareable mission replays (scrubbed), a
plugin API for adapters.

## Later (ideas; don't build yet)

Team missions, opt-in API-key seats, remote workers on the user's own machines, IDE extensions, a mobile companion to
approve merges.
