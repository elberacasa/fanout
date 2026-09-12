# The Fanout plugin for Claude Code

Claude Code becomes the lead: it plans a mission, fans it out to the other agent CLIs on your machine, watches them
work in isolated git worktrees, and reviews every diff. Nothing merges without you.

## What you get

| | |
|---|---|
| `/fanout <goal>` | Plan a mission, check it against the safety gate, launch it, and watch it |
| `/fanout:crew` | Which CLIs are installed, signed in, and ready |
| `/fanout:watch [mission]` | Subscribe to the live feed and review each run as it finishes |
| The `fanout` skill | The lead's judgment: when to fan out, how to write a prompt an agent can follow, how to review what comes back |
| Hooks | The crew at the start of a session; a warning if runs are still going when you stop |
| Seven MCP tools | `seats`, `repo_overview`, `plan_check`, `launch`, `mission_status`, `run_diff`, `cancel_mission` |

## Installing

The plugin runs `fanout mcp`, so the `fanout` command must be on your `PATH`.

**From a clone**, while the package is not yet published:

```sh
git clone https://github.com/elberacasa/fanout.git && cd fanout
corepack enable && pnpm install
pnpm --filter fanout-cli link --global   # puts `fanout` on your PATH
claude --plugin-dir "$PWD/plugin"          # try it in one session
```

Check it before you rely on it:

```sh
fanout status        # your crew
claude plugin validate plugin
```

## What it will not do

- **It will not merge.** It reads a run's diff from the workspace and hands you the decision. The merge gate, with
  review, your project's checks and proof that a fix fails on the old code, is the next milestone.
- **It will not work around a usage limit.** A seat that is out of quota is out; the lead says so and uses another.
- **It will not hand an agent your secrets.** Workspaces exclude ignored and deny-listed files, and a run gets an
  allowlisted environment only — never your shell's.
- **It sends nothing anywhere.** The daemon listens on `127.0.0.1` with a token only you can read.
