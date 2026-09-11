# Architecture

## Overview

```text
 Claude Code session (the lead: you + Claude)
   Fanout plugin: skill · /fanout commands · hooks · status line · MCP server config
        │ MCP tools (plan, launch, diff, review, merge …)      ▲ lead events (WebSocket → Monitor)
        ▼                                                     │
 fanoutd — local daemon (Node, TypeScript), vendor-neutral
   ├─ detector      finds agent CLIs, versions, sign-in state, loads adapter manifests
   ├─ adapters      one per CLI: build the headless command, parse its stream into our events
   ├─ planner       validates plans (schema, scopes, dependencies); the safety report
   ├─ policy        limits and permissions per run/seat; kills on breach; approval gates
   ├─ router        seat choice per line; concurrency caps; route-on-limit with a reason
   ├─ supervisor    launches runs (stdin closed), start detection, timeouts, kill, log capture
   ├─ workspace     git worktrees per editing run, archives for auditors, cleanup
   ├─ merge gate    review → checks → proof of fix → approval → git apply -3 (+ new files)
   ├─ ledger        SQLite, append-only events; projections for state, usage, scorecards; replay
   └─ api           MCP (for the lead) · HTTP + WebSocket (for the view, the CLI, the lead's event feed)
        │ codex exec · kimi -p · grok -p · cursor-agent -p · claude -p (opt-in)
        ▼
   worker runs, one worktree each                          mission view (localhost web page)
```

- **Claude Code is the lead; the daemon is the engine.** The plugin holds judgment and presentation (the skill,
  commands, hooks, status line). Everything mechanical and everything that must be correct (isolation, launch, merge,
  the ledger) lives in the daemon, in tested code. The daemon knows nothing about Claude Code specifically, so another
  brain can drive it later through the same MCP tools.
- **Everything is an event.** The daemon writes events to the ledger. The view, the CLI, the lead and replays read
  projections of them. There is no second source of truth.
- **Data stays local:** everything lives under `~/.fanout/` (the ledger, run logs, the workspace root). Per-repo
  settings go in `.fanout/` inside the repo (the plan, prompts and checks), which can be committed.

## How the lead uses Claude Code

| Claude Code feature | Role |
|---|---|
| **MCP server** (declared by the plugin; `fanout mcp`, stdio) | The lead's tools, below. Thin client of the daemon; starts the daemon if it isn't running |
| **Skill** | The lead's judgment: how to split work, write prompts, review diffs. The mechanics are tools, not prose |
| **Slash commands** | `/fanout <goal>`, `/fanout:status`, `/fanout:review`, `/fanout:merge` |
| **Monitor (WebSocket)** | Subscribes to the daemon's lead feed: only events the lead acts on (run finished, stuck, limit hit, out-of-scope write, merge ready). No polling |
| **Hooks** | `SessionStart`: crew and open missions. `PreToolUse`: block committing unreviewed agent work. `Stop`: warn about open runs |
| **AskUserQuestion** | Merge approval in the chat |
| **PushNotification** | "② ready to merge" when you have walked away |
| **Status line** | `fanout ▸ 3 running · 1 to review · codex ~40% (estimated)` |
| **Native subagents** | Claude as a worker is opt-in; the default workers are other vendors' CLIs |

## Event schema (first cut; finalized in milestone 1; versioned from day one)

```ts
type EventBase = { id: string; seq: number; ts: string; missionId: string; runId?: string; v: 1 };
type FanoutEvent =
  | EventBase & { type: "seat.detected"; seat: SeatInfo }                      // cli, version, signedIn, models, efforts, modes
  | EventBase & { type: "mission.created"; goal: string; limits: MissionLimits }
  | EventBase & { type: "plan.proposed" | "plan.revised"; plan: PlanGraph; by: "lead" | "user" }
  | EventBase & { type: "safety.report"; checks: SafetyCheck[]; ok: boolean }
  | EventBase & { type: "run.queued" | "run.started" | "run.paused" | "run.resumed"; line: LineRef; seat: SeatRef }
  | EventBase & { type: "run.progress"; phase: "reading" | "coding" | "testing" | "reporting"; detail?: string }
  | EventBase & { type: "run.tool"; tool: string; args?: unknown; files?: string[] }   // normalized from the CLI stream
  | EventBase & { type: "run.usage"; seat: SeatRef; amount: number; unit: "messages" | "tokens" | "minutes"; estimated: boolean }
  | EventBase & { type: "run.finished"; status: "done" | "failed" | "killed" | "timeout"; reportPath?: string; diffStat?: DiffStat }
  | EventBase & { type: "review.done"; verdict: "accept" | "rework" | "reject"; notes: string; by: SeatRef }
  | EventBase & { type: "checks.done"; ok: boolean; summary: string }
  | EventBase & { type: "proof.done"; ok: boolean; failedOnOld: string[] }
  | EventBase & { type: "merge.applied" | "merge.conflict" | "run.dropped"; detail?: string }
  | EventBase & { type: "route.changed"; line: LineRef; from: SeatRef; to: SeatRef; reason: string }
  | EventBase & { type: "policy.breach"; limit: string; action: "killed" | "paused" | "asked" };
```

## Seat adapters

The contract is in [ADAPTERS.md](ADAPTERS.md): a manifest (data) plus a small module (code). An adapter
**must not** touch credentials; it only calls the vendor CLI as its docs describe non-interactive use. Adding a CLI
means one folder; nothing else in the daemon changes.

## MCP tools (the lead's interface)

| Tool | Purpose |
|---|---|
| `seats` | The crew: installed CLIs, versions, sign-in state, usage (real or estimated), billing pool |
| `repo_overview` | A compact map of the repo for planning (read-only) |
| `propose_plan`, `revise_plan` | Write a plan graph; returns the safety report (validated against the schema and scopes) |
| `launch` | Start a validated plan (or some of its lines) |
| `wait_next` | Block until a run changes state; return a compact summary (fallback when Monitor isn't used) |
| `run_status`, `run_report`, `run_diff` | Inspect a run: report, diff stat, risky files, chosen hunks |
| `review` | Record a verdict (accept · rework · reject) with notes |
| `steer`, `kill`, `rework` | Control a run (`steer` only where the CLI supports resuming a session) |
| `merge`, `drop` | Final actions; merge still needs the checks, the proof and the user's approval unless policy says otherwise |

The lead never sees raw logs, only summaries and the diffs it asks for. That keeps its context small across many runs.

## Safety, in depth

- **Workspace:** `git worktree add` per editing run on a fresh branch from the mission's base commit. Auditors get a
  `git archive` copy. Gitignored files never appear in either. A deny-list (`.env*`, keys, credentials) is enforced
  before launch.
- **Process:** runs launch with stdin closed, their own working directory, the safest permission and sandbox flags
  the CLI offers, network off where supported, and time and step limits enforced by the supervisor.
- **Scopes:** each line declares its write paths. Parallel lines with overlapping scopes are refused before launch,
  and writes outside the scope are flagged in review.
- **Merge:** a queue per mission: review, the project's checks, the proof of fix, the user's approval (or an explicit
  policy), then `git apply -3`. Conflicts are reported, never forced.
- **Local surfaces:** the HTTP/WebSocket API binds to `127.0.0.1` only, requires a per-daemon token (kept in
  `~/.fanout/`, mode 600) and checks the `Origin` header, so a web page in your browser cannot drive the daemon.

## UI

- **Mission view:** React, served by the daemon on localhost, with a live WebSocket feed. Lanes per run, phase bars,
  tool ticker, diff peek, review queue, keyboard actions. Never hosted and never published as an artifact: it shows
  your code.
- **Design system:** tokens and components defined once (seat chip, energy bar, run lane, phase bar, diff peek,
  toast). Keyboard-first.
- **Later:** plan editing in the view (P1), a terminal companion, a native wrapper.

## Stack and layout (proposed; confirmed in session 1 with milestone 1)

```text
packages/
  core/        event schema, plan schema (zod), ledger, projections
  daemon/      detector, supervisor, workspace, policy, router, merge gate, api, mcp
  adapters/    codex/, claude/, kimi/, grok/, cursor/, fake/ … each: manifest.json + index.ts + fixtures/
  ui/          the mission view (React)
  cli/         `fanout` bin (npx-friendly): daemon, mcp, demo, status, statusline
plugin/        the Claude Code plugin: skill, commands, hooks, MCP config, status line
.claude/skills/codex-fanout/   how the lead delegates to Codex teammates while we build
docs/          the truth of the project
```

Tooling: pnpm workspaces, TypeScript strict, zod, vitest, Playwright (UI smoke), SQLite, @modelcontextprotocol/sdk,
ESLint + Prettier. MIT.
