# Vision

## The problem

Developers now pay for several AI coding subscriptions: Claude Pro or Max, ChatGPT Plus or Pro (Codex), Gemini, and
more. Each lives in its own terminal. They run **one at a time**, their quotas expire unused, and running several in
parallel means juggling terminals, branches and copy-paste, with no control and no safety net. API-key tools exist,
but they charge per token on top of subscriptions people already pay for, and they ask for keys.

## The idea

**Turn the subscriptions you already have into one crew.** One app finds every signed-in agent CLI on your machine,
lets a brain plan the work, lets you shape a parallel fan-out on a canvas, runs every agent safely, and brings back
reviewed, verified diffs. It is "Figma for agent work" with the control of a professional cockpit.

## Who it is for

1. **Power developers** who already use two or more agent CLIs and live in the terminal: they want parallelism
   without losing control.
2. **Small teams and indie builders** who want the output of five engineers from subscriptions they already pay for.
3. **Later:** teams that want shared missions, playbooks and scorecards.

## How we win

| Lever | Why it's hard to copy |
|---|---|
| **Subscriptions, no keys** | Needs a disciplined adapter layer per CLI, kept current: our core competence |
| **Quota-aware routing across subscriptions** | Needs usage signals per seat plus history; nobody balances *your* subscriptions |
| **Verification built in** | Worktrees, review, proof of fixes, merge queue: trust is the product |
| **The canvas + ledger** | Plan → shape → watch → review → replay in one place; the ledger makes it explainable |
| **Built in public by a crew** | The build log proves the method works; the product builds itself |

## What success looks like

- **Week 1 after launch:** the 60-second video, "found Claude Max, ChatGPT Pro and Gemini → one prompt → a live
  crew → reviewed diffs", spreads on its own; `npx` installs work first try.
- **Month 3:** daily use by developers with two or more subscriptions; missions end in merged, green diffs more often
  than not; a contributor community adds adapters.
- **Year 1:** the default way to run many coding agents on your own machine.

## What we will not be

- Not an API-key reseller or a cloud agent host.
- Not a game. It is professional software with a light, satisfying feel (progress, crew, energy bars), plus an
  optional playful skin for demos.
- Not "autonomous agents run wild". The human approves; the brain reviews; checks gate every merge.
