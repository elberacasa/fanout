---
name: fanout
description: Lead a crew of agent CLIs (Codex, Grok, Claude) through the Fanout tools - plan a mission, fan it out into isolated git worktrees, watch it, and review every diff before anything merges. Use when a task splits into independent pieces that can run in parallel, or when the user asks for the crew, a fan-out, or a mission. Not for a single edit you can make yourself.
---

# Leading a crew with Fanout

The Fanout MCP server runs the other agent CLIs on this machine. You stay the lead: you plan, you review, and the
user decides what merges. The tools do the mechanics — worktrees, launching, limits, the ledger — so that your
judgment is the only thing that has to be good.

## When this is worth it

Fan out when the work splits into pieces that touch **different files** and can be described precisely. Two lines
that need the same file are one line, or two lines in sequence. A single edit you can make in a minute is not a
mission; making it yourself is faster and better.

Good shapes:

| Shape | Seat | Scope |
|---|---|---|
| Map a system, find bugs, write a spec | auditor (read-only) | no write scope |
| Implement a well-specified change with tests | builder | the files it owns |
| Write tests for a rule before it exists | tester | the test files |
| One server contract, several clients | builders in parallel | one area each |

## The loop

1. `repo_overview` and `seats` before planning. No ready seat, no mission.
2. Write the plan. Per line: a narrow write scope, a prompt that names files, an example, the project's check
   commands and "do not commit", and the seat that suits the work. Risky or subtle work goes to the strongest seat;
   mechanical work to the cheapest. Claude is opt-in, because the lead already spends that subscription.
3. `plan_check`. It refuses overlapping scopes, missing seats, dangerous flags and uncommitted work inside a scope.
   Fix the plan rather than arguing with the gate.
4. `launch`. Tell the user the mission id and what each line will do.
5. `mission_status` while it runs; review each run with `run_diff` as it finishes rather than all at the end.
6. Report per run: what changed, what you would keep, what you would not, what you could not verify. The user
   decides what merges.

## Writing a prompt an agent can actually follow

Name the files. Give one example of input and expected output. State the invariants it must not break. Give the
exact check commands. Say "do not commit, do not create branches". Ask for a final message that lists what changed,
what it deliberately left alone, and the test counts — and say plainly when a sandbox could not run a check.

Agents do better with a checklist than with a goal.

## Reviewing what comes back

- Read the diff, not the report. `run_diff` reads the workspace itself; the report is the agent's own account.
- Look first at anything written **outside its declared scope**. That is where the surprises are.
- Check the invariants yourself: money, auth, migrations, anything that picks a default value, anything that could
  leak a real value into a test.
- A bug fix needs a test that fails on the old code. If it does not have one, that is the rework.
- Never present an agent's "tests pass" as your own verification. Run the project's checks yourself after applying.

## What this skill will not do

- It will not merge. Applying a diff is the user's decision, and the merge gate (with review, checks and proof)
  arrives in a later milestone.
- It will not work around a seat's usage limit. A seat that is out of quota is out; say so and use another.
- It will not hand an agent your secrets: workspaces exclude ignored and deny-listed files, and a run gets an
  allowlisted environment only.
