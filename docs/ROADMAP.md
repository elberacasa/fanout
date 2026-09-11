# Roadmap

Build only the current phase. New ideas go to "Later" at the bottom.

## P0 · Claude leads, the crew builds (target: 4–5 weeks)

**Goal:** from Claude Code with the Fanout plugin, a developer asks for a mission; Claude plans it, fans it out to
the other agent CLIs on the machine in isolated worktrees, the developer watches it live in the mission view, and
every diff passes review, checks and proof before the developer approves the merge. Plus an offline demo anyone can
try with no accounts, and a 30-second video that makes people want it.

Milestones, in order, each with tests green:

1. **Foundations:** pnpm monorepo, TypeScript strict, `npm run check`, CI; the event and plan schemas (zod); the
   ledger (append-only SQLite) with projections.
2. **Fake seat + supervisor:** a deterministic simulated agent (scriptable: phases, tool calls, diffs, failures,
   limits). The supervisor handles launch with stdin closed, start detection, timeouts, kill and log capture.
3. **Workspace + safety report:** worktrees and archives, the deny-list, scope-overlap validation, the dry-run
   command preview.
4. **Real seats:** the adapter kit plus Codex (default worker) and Claude (opt-in worker); then Kimi, Grok and Cursor
   (manifest, `detect`, `command`, `parse`, recorded fixtures, contract tests, terms reviewed).
5. **Daemon API + CLI:** HTTP, WebSocket (with the lead feed), the localhost token, and `fanout` (`daemon`, `demo`,
   `status`, `clean`).
6. **The Claude Code plugin:** the MCP server and tools, the skill, `/fanout` commands, hooks, the status line, the
   Monitor event feed, approvals and notifications.
7. **Merge gate:** review → checks → proof of fix → approval → `git apply -3` plus new files; rework (max 2) and drop;
   dependent lines start from the new commit; the mission summary.
8. **Mission view:** live lanes, phase bars, tool ticker, diff peek, review queue, approve and kill, keyboard-first.
   It must look excellent.
9. **Routing v1:** per-seat concurrency caps, route-on-limit with the reason shown, usage real where a CLI reports
   it, otherwise estimated and labelled.
10. **Demo + video + README:** `fanout demo` (offline, simulated seats, under 60 s, replayable), the 30-second video
    (see PRODUCT.md), and a README that sells it in 10 seconds.

**P0 is done when:** the offline demo runs on a clean machine; a real mission on a sample repo, with Claude Code
leading and at least three vendors' CLIs as workers, goes plan → safety → launch → watch → review → proof → merge →
verify, with a limit reroute visible; the video is recorded; every milestone is tested; and the build log shows the
crew's work.

## P1 · Smarter crew

Plan editing in the mission view (the canvas: + New line, prompt cards, dependency arrows), steering and pause,
second-vendor review by default, scorecards per seat and repo, full replay, Gemini, Qwen and OpenCode adapters as
they are installed and verified.

## P2 · Best of N

Tournament mode (the same line to N seats; the best passing diff wins, the loss costs are logged), routing learned
from scorecards, mission templates ("add a feature", "harden tests", "audit and fix"), plan diffs.

## P3 · Other brains and sharing

Codex or Gemini as the lead through the same MCP tools, a native wrapper, shareable mission replays (scrubbed), a
plugin API for adapters.

## Later (ideas; don't build yet)

Team missions, opt-in API-key seats, remote workers on the user's own machines, IDE extensions, a mobile companion to
approve merges.
