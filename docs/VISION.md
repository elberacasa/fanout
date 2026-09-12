# Vision

## The problem

Developers now pay for several AI coding subscriptions: Claude Pro or Max, ChatGPT Plus or Pro (Codex), Kimi, Grok,
Cursor, Gemini, and more. Each lives in its own terminal. They run **one at a time**, their quotas expire unused, and
running several in parallel means juggling terminals, branches and copy-paste, with no control and no safety net.

Tools that run several agents side by side in git worktrees now exist (see "The field" below). They solve the
*terminals* problem. They don't solve the *lead* problem: someone still has to split the work safely, write good
prompts, watch for trouble, review every diff, prove the fixes and merge on purpose. Today that someone is you, or a
Claude session following a long skill by hand.

## The idea

**Claude Code leads. Your other agents build.**

You stay in the Claude Code session you already use. Claude plans the mission, fans the work out to the other agent
CLIs on your machine, each in an isolated worktree, watches them live, reviews every diff across vendors, runs your
real checks, proves the fixes, and asks you before anything merges. A local mission view shows the whole crew at work.

We support **two seats deeply — Codex, and Claude itself when you opt in** — rather than many shallowly, because
everything that makes the gate good is vendor-specific: resuming the session that wrote a diff, asking a vendor's own
reviewer to check it, reading real quota windows. Others join through the seat kit, which is one folder (ADR 0017).

## Who it is for

1. **Claude Code users with a second subscription** (ChatGPT, Kimi, Grok, Cursor): they want parallel output without
   losing control, and without spending their Claude quota on the typing.
2. **Power developers and indie builders** who want the output of five engineers from subscriptions they already pay
   for.
3. **Later:** other brains (Codex or Gemini as the lead) and teams with shared missions and scorecards.

## The field (researched 2026-09-11)

| Kind | Examples | What they leave open |
|---|---|---|
| Parallel session runners | Conductor, Emdash, Parallel Code, Nimbalyst, Claude Squad, Vibe Kanban | You are the lead: no planner, no cross-vendor review, no proof gate |
| Plan-to-merge pipelines | Bernstein (CLI, one maintainer) | No live view, no reviewing brain, not where you already work |
| Vendor hubs | GitHub Agent HQ (cloud, Copilot Pro+), Claude Code Agent Teams (Claude only) | Cloud or single vendor; your code leaves the machine or only one vendor works |

## How we win

| Lever | Why it's hard to copy |
|---|---|
| **Lives inside Claude Code** | No new app; plan, review and approve in the chat you already use. A vendor won't orchestrate its competitors |
| **Cross-vendor review** | Claude reviews Codex's diff; another vendor reviews Claude's. Different models catch different mistakes |
| **A merge gate with proof** | Safety report before launch, your real checks, bug fixes proven to fail on the old code, your approval |
| **Honest quota routing** | When a seat hits its limit, work moves with the reason shown; estimates say "estimated" |
| **Built in public by a crew** | The build log proves the method works; the product builds itself |

## What success looks like

- **Launch:** a 30-second video (Claude plans, the crew builds in parallel, a rework lands back in its own session,
  reviews land, proof turns green, merged) makes a Claude Code user think "I need to try that", and the plugin
  installs first try.
- **Month 3:** daily use by developers with two or more subscriptions; missions end in merged, green diffs more often
  than not; contributors add adapters.
- **Year 1:** the default way to run many coding agents on your own machine.

## What we will not be

- Not an API-key reseller or a cloud agent host.
- Not a game. Professional software with a light, satisfying feel.
- Not "autonomous agents run wild". The human approves; the brain reviews; checks gate every merge.
