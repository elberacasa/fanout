# Architecture

## Overview

```text
 clients:  Canvas (React + React Flow, localhost)   Terminal companion (later)   CLI (`fanout …`)
           Brain seat ──MCP──┐
                             ▼
 daemon (Node 20+, TypeScript)
   ├─ detector      finds agent CLIs, versions, sign-in state, loads adapter manifests
   ├─ adapters      one per CLI: build the headless command, parse its stream into our events
   ├─ planner API   MCP server the brain uses (read repo, propose/revise plan, review diffs)
   ├─ policy        limits and permissions per run/seat; kills on breach; approval gates
   ├─ router        seat choice per line; quota-aware; fallback; (later) tournament
   ├─ supervisor    launches runs (stdin closed), start detection, timeouts, pause/kill, log capture
   ├─ workspace     git worktrees per editing run, archive copies for auditors, cleanup
   ├─ merge queue   review → checks → approval → git apply -3 (+ new files) → verify
   ├─ ledger        SQLite, append-only events; projections for state, usage, scorecards; replay
   └─ api           HTTP + WebSocket for the canvas; the CLI talks to the same API
```

- **Everything is an event.** The daemon writes events to the ledger. The canvas, the CLI, the brain and replays
  read projections of them. There is no second source of truth.
- **Data stays local:** everything lives under `~/.fanout/` (the ledger, run logs, the workspace root). Per-repo
  settings go in `.fanout/` inside the repo (the plan and prompt files), which can be committed.

## Event schema (first cut; version it from day one)

```ts
type EventBase = { id: string; ts: string; missionId: string; runId?: string; v: 1 };
type FanoutEvent =
  | EventBase & { type: "seat.detected"; seat: SeatInfo }                      // cli, version, signedIn, models, efforts, modes
  | EventBase & { type: "mission.created"; goal: string; limits: MissionLimits }
  | EventBase & { type: "plan.proposed" | "plan.revised"; plan: PlanGraph; by: "brain" | "user" }
  | EventBase & { type: "safety.report"; checks: SafetyCheck[]; ok: boolean }
  | EventBase & { type: "run.queued" | "run.started" | "run.paused" | "run.resumed"; line: LineRef; seat: SeatRef }
  | EventBase & { type: "run.progress"; phase: "reading" | "coding" | "testing" | "reporting"; detail?: string }
  | EventBase & { type: "run.tool"; tool: string; args?: unknown; files?: string[] }   // normalized from the CLI stream
  | EventBase & { type: "run.usage"; seat: SeatRef; amount: number; unit: "messages" | "tokens" | "minutes"; estimated: boolean }
  | EventBase & { type: "run.finished"; status: "done" | "failed" | "killed" | "timeout"; reportPath?: string; diffStat?: DiffStat }
  | EventBase & { type: "review.done"; verdict: "accept" | "rework" | "reject"; notes: string }
  | EventBase & { type: "checks.done"; ok: boolean; summary: string }
  | EventBase & { type: "merge.applied" | "merge.conflict" | "run.dropped"; detail?: string }
  | EventBase & { type: "route.changed"; line: LineRef; from: SeatRef; to: SeatRef; reason: string }
  | EventBase & { type: "policy.breach"; limit: string; action: "killed" | "paused" | "asked" };
```

## Seat adapters

The contract is in [ADAPTERS.md](ADAPTERS.md): a manifest (data) plus a small module (code). An adapter
**must not** touch credentials; it only calls the vendor CLI as its docs describe non-interactive use.

## MCP tools the daemon exposes (brain interface)

| Tool | Purpose |
|---|---|
| `repo_overview`, `read_file`, `search` | Let the brain plan without editing (read-only) |
| `propose_plan`, `revise_plan` | Write a plan graph (validated against the schema and scopes) |
| `wait_next` | Block until a run changes state; return a compact summary |
| `run_status`, `run_report`, `run_diff` | Inspect a run: report, diff stat, risky files, chosen hunks |
| `review` | Record a verdict (accept · rework · reject) with notes |
| `steer`, `pause`, `kill`, `rework` | Control a run |
| `merge`, `drop` | Final actions (merge still needs the checks and the user's approval unless policy says otherwise) |
| `seats`, `usage` | The crew, quotas, scorecards |

The brain never sees raw logs, only summaries and the diffs it asks for. That keeps its context small across many
runs.

## Safety, in depth

- **Workspace:** `git worktree add` per editing run on a fresh branch from the mission's base commit. Auditors get a
  `git archive` copy. Gitignored files never appear in either. A deny-list (`.env*`, keys, credentials) is enforced
  before launch.
- **Process:** runs launch with stdin closed, their own working directory, the safest permission and sandbox flags
  the CLI offers, network off where supported, and time and step limits enforced by the supervisor.
- **Scopes:** each line declares its write paths. Parallel lines with overlapping scopes are refused before launch,
  and writes outside the scope are flagged in review.
- **Merge:** a queue per mission. The steps are brain review, the project's checks, the user's approval (or an
  explicit policy), then `git apply -3`. Conflicts are reported, never forced.

## UI

- **Canvas:** React + React Flow (nodes are lines, edges are dependencies, the brain node on top), with a live
  WebSocket feed. Built as a local web app served by the daemon. A Tauri wrapper gives a native feel later.
- **Design system:** tokens and components defined once (seat chip, energy bar, run card, phase bar, diff peek,
  toast, sheet). Keyboard-first with ⌘K.
- **Terminal companion (later):** the same API, Ink or Bubble Tea.

## Stack and layout (proposed; confirm in session 1)

```text
packages/
  core/        event schema, plan schema (zod), ledger, projections
  daemon/      detector, adapters, supervisor, workspace, policy, router, merge queue, api, mcp
  adapters/    claude/, codex/, fake/, (gemini/, kimi/, grok/, qwen/ … later) each: manifest.json + index.ts + fixtures/
  ui/          React + React Flow canvas
  cli/         `fanout` bin (npx-friendly)
.claude/skills/codex-fanout/   how the lead delegates to Codex teammates
docs/          the truth of the project
```

Tooling: pnpm workspaces, TypeScript strict, zod, vitest, Playwright (UI smoke), better-sqlite3 or node:sqlite,
@modelcontextprotocol/sdk, ESLint + Prettier. MIT.
