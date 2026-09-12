---
name: fanout
description: Lead a crew of agent CLIs (Codex, Grok, Claude) through the Fanout tools - plan a mission, fan it out into isolated git worktrees, watch it, and review every diff before anything merges. Use when a task splits into independent pieces that can run in parallel, or when the user asks for the crew, a fan-out, or a mission. Not for a single edit you can make yourself.
---

# Leading a crew with Fanout

The Fanout MCP server runs the other agent CLIs on this machine. You stay the lead: you plan, you review, and the
user decides what merges. The tools do the mechanics — worktrees, launching, limits, the ledger — so that your
judgment is the only thing that has to be good.

## Before you say anything is done

This part applies to **your own** code, not only to work you fanned out. Most of the code in a session is written
by you and read by nobody else, and your own reasoning is exactly what makes your mistakes invisible to you: you
know why it is right, so it looks right.

So before telling the user work is finished, call `check_claims` with two to four things you believe about your own
uncommitted changes. Another vendor's CLI reads them cold — no plan, no justification, just the diff — and tries to
falsify each one.

**Write claims that can be proven false.**

| Write this | Not this |
|---|---|
| "No caller of `total()` passes fewer than two arguments" | "The refactor is safe" |
| "Nothing outside `src/api/` changed behaviour" | "It works" |
| "Every new branch in `parse()` has a test" | "Well tested" |
| "A symlink cannot lead the reviewer outside the copy" | "Isolation is handled" |

Half the value arrives before the tool runs: a claim you cannot phrase falsifiably is usually one you have not
actually checked.

**Read the verdicts as written.** `confirmed` means it was actively checked. `unclear` means the reader could not
tell — which is *not* a pass, and is worth a second look at whether the claim was answerable. `refuted` means stop:
fix it, and when you fix it, add the test that would have caught it, so it cannot come back.

State the refutations to the user in the reader's own words. A second opinion that you summarise into agreement is
not a second opinion.

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

## Bringing a run home

When an agent finishes, the gate is four tools in order, and each one records the revision it judged. If the work
changes between any two of them, the later ones refuse — which is the point.

1. **`run_diff`** — read it yourself, line by line, before anything else. An agent's report is what it believes it
   did.
2. **`review_run`** — your verdict, and *what you actually checked*. "Looks fine" is not a review. `rework` sends
   it back to the same session; `reject` ends the line.
3. **`rework_run`** if you asked for changes — it continues the same conversation in the same worktree, so the
   agent still has its own reasoning about the code. Running the line again instead throws that away and costs the
   same. Two rounds; after that, decide rather than asking a third time.
4. **`run_checks`** — the project's own commands, run by the gate rather than reported by the agent. A line that
   declared no checks comes back **unverified**, which is not the same as passing.
5. **`prove_fix`** — only for a line the plan marked `fixesBug`. The test goes onto the *old* code and must fail
   there. If it passes, it would have passed before the fix.
6. **Ask the user**, in the chat, in their own words. Then **`merge_run`** with what they said.

You cannot merge your own way past any of this: `merge_run` asks a pure function over recorded facts, and reports
the refusals rather than working around them. Read them out to the user as written.

**Never call `merge_run` without having asked.** The tool records the user as the authority, and a replay months
from now will show that. Putting words in their mouth there is the worst thing you can do with these tools.

## The claim loop, in full

```text
claim  →  refuted  →  failing test  →  fix  →  checked again  →  confirmed
```

The middle step is the one people skip. A refutation you fix without a test is a bug you will write again; a
refutation you fix *with* a test that fails on the old code is the project's fourth non-negotiable, satisfied
without anybody having to be reminded of it.

## What this skill will not do

- It will not merge. Applying a diff is the user's decision, and the merge gate (with review, checks and proof)
  arrives in a later milestone.
- It will not work around a seat's usage limit. A seat that is out of quota is out; say so and use another.
- It will not hand an agent your secrets: workspaces exclude ignored and deny-listed files, and a run gets an
  allowlisted environment only.
