# Product

## Concepts

| Concept | Meaning |
|---|---|
| **Lead** | Your interactive Claude Code session, with the Fanout plugin. It plans, launches, watches, reviews and asks you before merging |
| **Seat** | An installed, signed-in agent CLI (Codex, Kimi, Grok, Cursor, Claude, …) with its models, effort levels, permission modes and a usage meter |
| **Mission** | One goal ("add CSV export") with limits (time, usage share, max parallel agents) |
| **Plan** | A graph of lines: role (auditor · builder · tester), write scope, dependencies, seat, model, effort, prompt, checks |
| **Line** | One task in the plan, bound to a seat. It becomes a run when launched |
| **Run** | One agent working: a worktree (or read-only archive), a live structured stream, artifacts |
| **Policy** | Limits and permissions per line or seat: time, steps, usage, allowed paths, network, approval gates |
| **Artifacts** | Diff, report, test results, usage, scorecard entry |
| **Ledger** | The append-only event log everything reads |

## The flow, inside Claude Code

```text
① Crew check → ② Ask → ③ Plan → ④ Safety report → ⑤ Launch → ⑥ Watch → ⑦ Review → ⑧ Merge gate → ⑨ Summary
```

1. **Crew check** (session start, by a hook): "Crew: Codex (ChatGPT) · Kimi · Grok · Claude (opt-in) · Cursor (not
   signed in)". Open missions and unmerged diffs are listed too.
2. **Ask:** `/fanout add CSV export and fix the flaky date test`, or just ask Claude in plain words.
3. **Plan:** Claude reads the repo and proposes the plan through the plugin's tools. You see it in the chat and in the
   mission view: each line's role, scope, seat, effort, estimated usage and a one-line rationale. Change it in plain
   words ("use Kimi for the tests", "split the UI line").
4. **Safety report** (must be green to launch, or explicitly overridden): no overlapping write scopes between parallel
   lines; secrets and gitignored files excluded; every seat on its safest workable permission and sandbox mode;
   network off where the CLI allows it; per-seat concurrency caps; the exact commands that will run.
5. **Launch:** each line becomes a run in its own worktree. Dependent lines start automatically from the new commit
   when the line they wait for merges.
6. **Watch:** the mission view shows every run live: phase bar (reading → coding → testing → done), the current tool
   call, files touched, tests, a growing diff, elapsed time and usage. Claude is woken only by events that need the
   lead (finished, stuck, hit a limit, wrote outside its scope). The status line shows the crew at a glance.
7. **Review:** Claude reads the report and the risky hunks, checks the invariants, and records a verdict: accept,
   rework (notes go back to the same worktree, max 2) or reject. Writes outside the scope are flagged automatically.
   Optionally a second vendor reviews too.
8. **Merge gate:** the project's checks run (including those the agent's sandbox could not run); a bug fix must come
   with a test proven to fail on the old code; then you approve in the chat or the view. Merge is a 3-way apply plus
   new files. Conflicts are reported, never forced.
9. **Summary:** what merged, what was dropped and why, time, usage per seat, and the scorecard updates. Every mission
   can be replayed from the ledger. If you walk away, a notification tells you when a decision is waiting.

## The mission view

A local web page served by the daemon on `127.0.0.1`. Never hosted, never published. It is the part you watch:

```text
Mission: add CSV export          3 running · 1 ready for review · 12 min · Codex ~18% (estimated)
┌──────────────────────────────────────────────────────────────────────────────┐
│ ① auditor  codex·high  map export code        ██████████ done     report ▸   │
│ ② builder  codex·med   src/api/export/**      ███████░░░ testing  +84 −3  ▸  │
│      now: running `pnpm test export`           files: route.ts, csv.ts        │
│ ③ builder  kimi        src/ui/export/**       ████░░░░░░ coding   +40     ▸  │
│ ④ tests    grok        tests/export/**        waits for ② (dependency)       │
├──────────────────────────────────────────────────────────────────────────────┤
│ Review queue:  ① accepted by Claude  ·  checks ✓  ·  [Merge] [Rework] [Drop]  │
│ Safety: scopes disjoint ✓  .env excluded ✓  network off ✓                     │
└──────────────────────────────────────────────────────────────────────────────┘
   [s] steer  [k] kill  [d] diff  [m] merge  [r] rework
```

P0 is watch, diff peek, approve, kill. Editing the plan graph in the view comes in P1; in P0 you edit the plan in the
chat or in `.fanout/plan.json`.

## The 30-second video (the bar for P0)

| Time | What you see |
|---|---|
| 0–4 s | In Claude Code: `/fanout add dark mode, CSV export, and fix the flaky date test` |
| 4–9 s | Claude's plan lands; the mission view opens: five lines on Codex, Kimi, Grok and Claude; the safety report turns green |
| 9–20 s | Five lanes come alive: phases move, tool calls tick, diffs grow. One seat hits its limit and its pending line moves, with the reason shown. One write outside scope is flagged |
| 20–27 s | Reviews land; a proof test goes red on the old code, green on the new; checks pass; `m` `m` `m` |
| 27–30 s | Summary: 4 merged · 1 dropped · 3 vendors · all checks green |

Real runs take minutes; the video is sped up and says so. `fanout demo` reproduces the same story offline with
simulated seats, so anyone can see it without accounts.

## The feel: professional, lightly gamified

- Seats are crew members in their provider's color. Usage is an energy bar.
- **Scorecards per seat, per repo:** first-try accept rate, speed, rework count. They inform routing.
- **A clear mission summary** at the end: numbers first, one line per merged change.
- **Keyboard-first** in the view; plain words in the chat.

## Quota-aware routing

- **Signals:** the CLI's own usage output when one exists (real); limit messages in its stream; otherwise estimated
  from our run history (labelled "estimated"). Windows such as "5-hour" limits are modelled per seat. We never call a
  provider's private endpoints to read usage.
- **Rules first:** cheap work (docs, tests) goes to the seats with the most headroom; risky work goes to the seats you
  mark "strong"; a failure retries once on a different seat; a line never moves without the reason shown.
- **Later:** tournament mode (the same line to N seats; the best passing diff wins), routing learned from scorecards.

## Safety model (summary; details in ARCHITECTURE.md)

Worktree or archive isolation · no secrets, no gitignored files · safest CLI permission and sandbox flags · network
off where possible · path scopes enforced before launch · per-run limits with kill · agents never commit · review +
checks + proof + approval before merge · everything in the ledger · the view and API bound to localhost with a token.

## Out of scope (for now)

Cloud execution, team accounts, API-key seats (possible later as an explicit, opt-in seat type), a native app, a
mobile app, brains other than Claude Code, and any provider integration that is not the vendor's official CLI.
