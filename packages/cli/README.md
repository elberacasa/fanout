# fanout-cli

Let Claude Code lead the other coding-agent CLIs you already pay for.

Fanout is a local daemon and a Claude Code plugin. Claude plans the work; the other agents you have installed and
signed in — Codex, and Claude itself when you opt in — do pieces of it in parallel, each in its own git worktree.
Nothing merges until it has been reviewed by someone who did not write it, passed your project's own checks, and
been approved by you.

## See it without an account

```sh
npx fanout-cli demo
```

Three simulated agents run a real mission on a throwaway repository, in real worktrees, through the real gate. No
sign-in, no API key, no network. It prints a local URL — open it to watch.

## Use it for real

```sh
npm install -g fanout-cli
fanout seat        # what is installed on this machine, and what is signed in
fanout demo        # the offline walkthrough
fanout help        # everything else
```

Then add the plugin, which is what Claude Code drives:

```
/plugin marketplace add elberacasa/fanout
/plugin install fanout@fanout
```

That gives you `/fanout <goal>` inside your session.

## What it will not do

- **It never touches your credentials.** Each agent runs through its vendor's own documented non-interactive mode,
  on your machine, under your account. Fanout does not read, copy, store, proxy or reuse a session token, and does
  not work around anyone's rate limits.
- **It never merges unreviewed work.** Review, your project's checks, and your approval must all have judged the
  same revision of the same diff. A bug fix additionally needs a test proven to fail on the old code.
- **It never commits on your branch without you.** Agents work in isolated worktrees and cannot reach your files,
  your secrets, or anything git ignores.
- **It sends nothing anywhere.** Your code, your prompts and the ledger stay on your machine. There is no telemetry.

Requires Node 22.18 or newer. MIT licensed.
