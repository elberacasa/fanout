# Product

## Concepts

| Concept | Meaning |
|---|---|
| **Seat** | An installed, signed-in agent CLI (Claude Code, Codex, Gemini, Kimi, Grok, Qwen, …) with its models, effort levels, permission modes and a quota meter |
| **Brain** | The seat that plans and reviews. Claude Code by default; any seat that can use MCP can be the brain |
| **Mission** | One goal ("add CSV export") with limits (time, quota share, max parallel agents) |
| **Plan** | A graph of tasks: role (auditor · builder · tester), file scope, dependencies, the suggested seat, model and effort, prompt card, checks |
| **Line** | One task on the canvas, bound to a seat. It becomes a run when launched |
| **Run** | One agent working: a worktree (or read-only archive), a live structured stream, artifacts |
| **Policy** | Limits and permissions per line or seat: time, steps, quota, allowed paths, command allowlist, network, approval gates |
| **Artifacts** | Diff, report, test results, usage, scorecard entry |
| **Ledger** | The append-only event log everything reads |

## The flow

```text
① Crew check → ② Prompt → ③ Brain plans → ④ Shape on canvas → ⑤ Safety report → ⑥ Launch → ⑦ Watch → ⑧ Merge queue → ⑨ Summary & replay
```

1. **Crew check (on open):** "Found: Claude Code (Max) · Codex (Pro) · Gemini · Kimi (not signed in)". Each seat
   shows its version, sign-in state, models and quota ("real" or "estimated").
2. **Prompt:** the goal, in plain words. Optional: attach files or pick a playbook.
3. **Brain plans:** the brain reads the repo through tools the daemon exposes (MCP) and returns a plan graph with a
   short rationale per line and an estimated quota cost per seat.
4. **Shape:**
   - **+ New line:** pick seat, model and effort, drop a prompt card on it, set its scope.
   - Drag prompt cards between lines, connect lines with arrows for dependencies, set limits per line.
   - **Ask the brain** to revise ("split the UI line", "use Codex for tests").
5. **Safety report (must be green to launch, or explicitly overridden):**
   - no overlapping write scopes between parallel lines;
   - secrets and gitignored files excluded; every seat on its safest workable permission and sandbox mode;
   - network off where the CLI allows it; per-seat concurrency and quota caps;
   - a dry-run preview of the commands that will run.
6. **Launch:** each line becomes a run in its own worktree. Quota-aware routing may move pending lines to another
   seat, with the reason shown.
7. **Watch:**
   - **Each line shows:** a phase progress bar (reading → coding → testing → done), the current tool call, files
     touched, a quota gauge, a mini diff, and its status.
   - **Actions on a line:** pause, kill, steer (send a message), fork to another seat, rework.
8. **Merge queue:**
   - Each finished run gets the brain's review (risks, invariants, test proof), then the project's checks, then your
     decision.
   - **Merge** applies with a 3-way merge plus new files, **Rework** sends the review notes back to the same worktree
     (max 2), **Drop** discards it.
9. **Summary and replay:** what merged, what was dropped and why, usage per seat, and the scorecard updates. Scrub
   through the whole mission from the ledger.

## The feel: professional, lightly gamified

- Seats are crew members, in the provider's color and emblem. Quota is an energy bar. The brain sits at the top of
  the canvas.
- **Scorecards per seat, per repo:** win rate, speed, how often the brain's review accepted its work, rework count.
  They inform routing and are satisfying to watch grow.
- **A clear mission summary** at the end: numbers first, one line per merged change.
- **Keyboard-first:** every action has a key, and a ⌘K command palette. A terminal companion UI exists for CLI
  lovers.
- **Optional "factory" skin** (pixel workers on a conveyor) for demos and fun. The default look stays professional.

## Quota-aware routing

- **Signals:** the CLI's own usage or status output when it exists (real); otherwise estimated from our run history
  (labelled "estimated"). Windows such as "5-hour" limits are modelled per seat.
- **Rules first:**
  - cheap work (docs, tests) goes to the seats with the most headroom;
  - risky work goes to the seats the user marks "strong";
  - a failure retries once on a different seat.
- **Later:** tournament mode (the same line to N seats; the best passing diff wins), and routing learned from
  scorecards.

## Safety model (summary; details in ARCHITECTURE.md)

Worktree or archive isolation · no secrets, no gitignored files · safest CLI permission and sandbox flags · network
off where possible · path scopes enforced before launch · per-run limits with kill · agents never commit ·
review + checks + approval before merge · everything in the ledger.

## Out of scope (for now)

Cloud execution, team accounts, API-key seats (possible later as an explicit, opt-in seat type), a mobile app, and
any provider integration that is not the vendor's official CLI.
