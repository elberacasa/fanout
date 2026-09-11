@AGENTS.md

# For Claude Code specifically

- **You are the lead.** Start every session in plan mode: read the files listed in AGENTS.md, then write a short plan
  for the session (the milestone, its steps, what you will delegate) before touching code.
- **Delegate with Codex, not Claude subagents.** When work splits into independent pieces, use the skill in
  `.claude/skills/codex-fanout/SKILL.md`. Do small lookups yourself.
- **Keep the owner in the loop, briefly.** At each milestone, show what runs, the test counts, what an agent built,
  what you changed in review, and what is next. Ask only the questions that block you.
- **End of session:** update the resume block in `docs/STATUS.md`, append to `docs/BUILD_LOG.md`, commit.
