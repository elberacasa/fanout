# Roadmap

Build only the current phase. New ideas go to "Later" at the bottom.

## P0 · The crew works (target: 3–4 weeks)

**Goal:** from `npx fanout`, a developer sees their signed-in CLIs, plans with the brain, launches a safe fan-out,
watches it on the canvas, reviews and merges. Plus an offline demo anyone can try with no accounts.

Milestones, in order, each with tests green:

1. **Foundations:** pnpm monorepo, TypeScript strict, `npm run check`, CI; the event and plan schemas (zod); the
   ledger (append-only SQLite) with projections.
2. **Fake seat + supervisor:** a deterministic simulated agent. The supervisor handles launch with stdin closed, start
   detection, timeouts, kill and log capture.
3. **Workspace + safety report:** worktrees and archives, the deny-list, scope-overlap validation, a dry-run preview.
4. **Detection + real seats:** Claude Code and Codex adapters (manifest, `detect`, `command`, `parse`, fixtures,
   contract tests, terms reviewed).
5. **Daemon API:** HTTP and WebSocket, and the `fanout` CLI (`demo`, `run`, `status`, `review`, `merge`, `clean`).
6. **Canvas (read-only):** live missions, the crew panel, run cards, phase bars, diff peek.
7. **Canvas (editing):** the brain node, + New line (seat, model, effort), prompt cards, dependency arrows, per-line
   limits, the safety report gate.
8. **Brain via MCP:** the planner tools; Claude Code as the default brain proposes and revises plans and reviews
   diffs.
9. **Merge queue:** review → checks → approval → `git apply -3`; rework (max 2) and drop; the mission summary.
10. **Quota v1:** real or estimated meters per seat, per-seat caps, route-on-limit with the reason shown.
11. **Demo + README:** `fanout demo` (5 lines, offline, under 60 s, replayable), the recorded video, and a README that
    sells it in 10 seconds.

**P0 is done when:** the offline demo runs on a clean machine; a real mission on a sample repo with Claude Code as
the brain and the Claude and Codex seats goes plan → shape → safety → launch → watch → review → merge → verify with a
quota cap enforced and visible; every milestone is tested; and the build log shows the crew's work.

## P1 · Smarter crew

Gemini adapter, then Kimi, Qwen and Grok as their official CLIs are verified. Steering, pause and resume, approval
gates, scorecards per seat and repo, full replay UI, the terminal companion, the ⌘K palette everywhere.

## P2 · Best of N

Tournament mode (the same line to N seats; the best passing diff wins, the loss costs are logged), routing learned
from scorecards, mission templates ("add a feature", "harden tests", "audit and fix"), plan diffs.

## P3 · Native feel and sharing

The Tauri app, the factory skin, shareable mission replays (scrubbed), a plugin API for adapters.

## Later (ideas; don't build yet)

Team missions, opt-in API-key seats, remote workers on the user's own machines, IDE extensions, a mobile
companion to approve merges.
