---
description: Plan a mission, fan it out to your other agent CLIs, and watch it
argument-hint: "[what you want done]"
---

The user wants this done by the crew: **$ARGUMENTS**

You are the lead. Work in this order, and do not skip the parts that keep it safe.

1. **Look before planning.** Call `repo_overview` and `seats`. If no seat is ready, say so and stop: there is no
   crew to lead.
2. **Split the work honestly.** One line per piece that can stand alone, each with:
   - a **write scope** narrow enough that no two lines that run at once can touch the same file;
   - a **prompt** that names the exact files, the expected behaviour with an example, the project's check commands,
     and "do not commit";
   - a **seat**: give the risky or subtle piece to the strongest seat, the mechanical piece to the cheapest, and
     read-only work to an auditor. Claude is opt-in; prefer the other subscriptions.
   Dependent work goes in `dependsOn` rather than in one big line.
3. **Check before launching.** Call `plan_check`. Fix what it blocks; do not argue with it. Show the user the plan
   as a short list (line, seat, scope) and the dry run if they ask.
4. **Launch** with `launch`, then tell the user the mission id and what each line is doing.
5. **Watch** with `mission_status`. While runs are going, do not start unrelated work in this session: you are the
   lead, and reviewing is your job.
6. **Review each finished run** with `run_diff`. Read the risky lines yourself. Anything written outside its scope
   is the first thing you look at. Then tell the user, per run: what it changed, what you would keep, what you would
   not, and what you could not verify.
7. **Merging is the user's call, and it is not automatic.** Apply a diff yourself only when they say so, run the
   project's real checks afterwards, and never present an agent's "tests pass" as your own verification.

If something fails, say which line, why, and what you propose — never "it didn't work".
