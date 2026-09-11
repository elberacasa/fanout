# Rules for every agent in this repository

You may be Claude Code (the lead) or a Codex agent (a teammate). Read this whole file before doing anything. Then
read, in order: `docs/STATUS.md` (resume block: the truth of today), `docs/VISION.md`, `docs/PRODUCT.md`,
`docs/ARCHITECTURE.md`, `docs/ROADMAP.md`, `docs/PLAYBOOK.md`, `docs/DECISIONS.md`. Nothing else is needed; if a
fact is not in this repo, it is not known.

## What we are building (one paragraph)

A Claude Code plugin plus a local daemon that let Claude Code lead a crew of the other coding-agent CLIs a developer
already has installed and signed in (Codex, Kimi, Grok, Cursor, and Claude itself when opted in), using their
subscriptions through each CLI's official non-interactive mode. Claude plans the mission; agents work in parallel in
isolated git worktrees; a local mission view shows them live; every diff is reviewed, checked and proven before the
developer approves the merge. Details: `docs/PRODUCT.md`.

## Product non-negotiables (never trade these for speed)

1. **Subscriptions through official headless modes only.** We run the vendor's own CLI the way its docs describe
   non-interactive use. We never read, copy, store, proxy or reuse its credentials or session tokens, never call a
   provider's private endpoints, and never work around rate limits, quotas or regional restrictions.
2. **The user's own machine and accounts.** No shared seats, no reselling, no remote execution of someone else's
   subscription.
3. **Isolation.** Every editing agent works in its own git worktree; auditors get a read-only archive. Agents never
   commit, never touch the user's branch, never receive secrets or gitignored files.
4. **Nothing merges unreviewed.** Merge = brain review + the project's checks + the user's approval (policy may
   pre-approve, explicitly). A bug fix ships with a test that fails on the old code.
5. **Local-first, private by default.** Code, prompts and the ledger stay on the machine. No telemetry unless the
   user turns it on.
6. **Honest UI.** Estimated numbers say "estimated"; unknown states say so; a failed load never looks like "nothing
   to do".

## Engineering rules

- **TypeScript, strict**, Node 22.13+ for the daemon; React for the UI (see `docs/ARCHITECTURE.md`). No new dependency
  without a one-line reason in the commit message.
- **The ledger is append-only and event-sourced.** State is derived from events; never mutate or delete history.
- **Every adapter** has a version-pinned manifest and contract tests against recorded streams
  (`docs/ADAPTERS.md`). Unknown CLI versions show "unsupported version" instead of guessing.
- **Small commits, tests green, on `main`.** One idea per commit. Run `npm run check` (typecheck + lint + tests)
  before every commit once it exists.
- **Docs are part of the change.** When behaviour changes, update the doc in the same commit. Update the resume block
  in `docs/STATUS.md` at the end of every session so the next agent can start cold.
- **Phase discipline.** Build what the current phase in `docs/ROADMAP.md` asks for, not later phases. Write ideas
  into the roadmap instead of building them.

## The crew (how we build)

- **Claude Code is the lead:** it plans, writes precise prompts, reviews every diff, runs the full checks, merges
  and keeps the docs true.
- **Codex agents are teammates:** parallel builders, auditors and test writers, each in its own worktree, launched
  with the `codex-fanout` skill in `.claude/skills/codex-fanout/`. Follow its procedure exactly (stdin closed, the
  sandbox limits, review, `git apply -3`, proof of fixes).
- **Credit every contribution.**
  - Commits end with trailers naming who built it: `Co-Authored-By: Claude …` for the lead, and
    `Built-by: codex (<model>) via codex-fanout · reviewed by Claude` for merged agent work.
  - Each session appends an entry to `docs/BUILD_LOG.md`: what was built, by whom, the prompt file, what review
    changed, and the test counts.

## Commit message format

```
<area>: <what changed, in the present tense> (<YYYY-MM-DD HH:MM local>)

<why, in 1–4 lines; what was reviewed or proven>

Co-Authored-By: Claude <model> <noreply@anthropic.com>
Built-by: codex (<model>) via codex-fanout · reviewed by Claude   ← only when agent work is included
```

## Never

- Never weaken a non-negotiable to make a test pass or a demo look good.
- Never put real user data, credentials or private code into fixtures, prompts to other agents, or the build log.
- Never publish, push to a remote, create accounts, or spend money without the owner's explicit word.
