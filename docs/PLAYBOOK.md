# Playbook: how the crew builds this

We build Fanout the way Fanout will let everyone build: **one lead and parallel teammates, isolated, reviewed and
verified.** Until Fanout can build itself, the lead is Claude Code and the teammates are Codex agents launched with
the `codex-fanout` skill (`.claude/skills/codex-fanout/SKILL.md`). Once P0 ships, we switch to Fanout itself:
**"Fanout built Fanout"** is the story.

## Roles

| Role | Who | Does |
|---|---|---|
| **Owner** | the human | sets direction, approves plans and anything public or costly, tests real use |
| **Lead** | Claude Code | plans sessions, writes prompts, reviews every diff, runs all checks, merges, keeps docs true |
| **Builder** | Codex agent | implements a well-specified piece with tests, in its own worktree |
| **Auditor** | Codex agent (read-only) | maps code, finds bugs, writes specs, reviews designs |
| **Test writer** | Codex agent | writes tests for a rule before or while it is built |

## The session loop (lead)

1. **Resume:** read AGENTS.md, then the resume block in `docs/STATUS.md`, then the current milestone in
   `docs/ROADMAP.md`.
2. **Plan:** the milestone's steps. Decide what you build yourself (anything critical, cross-cutting or small) and
   what goes to teammates (independent pieces with clear contracts and separate files). Write it in 5–15 lines.
3. **Contract first:** you write the shared types, schemas and interfaces yourself, then fan out the implementations
   against them.
4. **Fan out:** one worktree and one precise prompt per teammate (the templates are in the skill). Launch in the
   background.
5. **Review:** read each report and diff. Check the non-negotiables yourself. Merge with `git apply -3`. Prove fixes
   fail on the old code.
6. **Verify:** `npm run check`, plus the UI smoke tests and the demo run, done by you, never taken from an agent's
   word.
7. **Record:** commit with trailers, append to the build log, update the STATUS resume block.

## Good tasks for teammates

- An adapter's `parse()` against recorded fixtures. The contract is clear, and the files stay separate.
- UI components against a finished event schema.
- Test suites for a schema or a module whose interface is settled.
- Audits: "map every place that touches the workspace; list the risks".
- Docs and examples, once the behaviour exists.

## Keep for the lead

The event and plan schemas, the policy engine, the merge queue, anything touching isolation or credentials, and
cross-package refactors.

## Quality bar

- Every merged change has tests. Bug fixes have a test that fails on the old code.
- The demo and the smoke tests stay green.
- Docs match behaviour in the same commit.
- The build log is honest: it records what an agent built, what the lead changed in review and why, and what could
  not be verified.
