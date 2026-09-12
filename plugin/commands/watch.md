---
description: Watch a running mission and review each run as it finishes
argument-hint: "[mission id]"
---

Watch the mission **$ARGUMENTS** (if no id is given, use the most recent one you launched).

Subscribe to the live feed rather than polling in a loop: start a Monitor on the daemon's WebSocket, which only
sends the events a lead acts on.

```
ws://127.0.0.1:<port>/events?for=lead&missionId=$ARGUMENTS&token=<token>
```

The port is in `~/.fanout/daemon.json` and the token in `~/.fanout/token`. Read both; never print the token.

When a run finishes, review it straight away with `run_diff` while the rest are still going: read what it changed,
look first at anything written outside its declared scope, and tell the user in two or three lines what you would
keep and what you would not. When every run has finished, give the mission summary: what succeeded, what failed and
why, and what you recommend merging.
