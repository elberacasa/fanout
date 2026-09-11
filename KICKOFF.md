# Kickoff: session 1

Open Claude Code in this folder, switch to plan mode (Shift+Tab), and paste:

```text
You are the lead engineer of this repository. Start cold: read AGENTS.md completely, then docs/STATUS.md,
docs/VISION.md, docs/PRODUCT.md, docs/ARCHITECTURE.md, docs/ADAPTERS.md, docs/ROADMAP.md, docs/PLAYBOOK.md,
docs/DECISIONS.md and .claude/skills/codex-fanout/SKILL.md. Everything you need is in this folder.

This session's goals, in order:
1. Crew check on this machine: find which agent CLIs are installed (claude, codex, gemini, qwen, opencode, and any
   Kimi or Grok CLI) with `which` and `--version`; check sign-in state only through each CLI's own status command
   (never read credential files); read each installed CLI's `--help` for its non-interactive mode, structured
   output flag, model/effort options and permission/sandbox flags. Update docs/ADAPTERS.md with what you verified
   (keep "to verify" where you could not).
2. Open decisions: propose 5 name candidates with a quick availability check (npm, GitHub) and a recommendation;
   confirm or adjust the stack in DECISIONS 0006. Ask me to choose; do not rename anything until I answer.
3. Plan P0 milestone 1 (Foundations) in detail: the files, the scripts (`npm run check`), CI, the zod event and plan
   schemas, the ledger with projections, and the tests. Show me the plan and wait for my approval.
4. After approval, build milestone 1 yourself (it is the contract everything else depends on), with tests green and
   small commits in the format from AGENTS.md. Then prepare, but do not launch yet, the Codex teammate prompts for
   milestone 2 (the fake seat and the supervisor) using the skill's templates, and show them to me.
5. End of session: update docs/STATUS.md (resume block) and docs/BUILD_LOG.md, and commit.

Rules that matter most: subscriptions only through official headless modes; never touch credentials; isolation and
review before any merge; phase discipline; nothing public without my word.
```

Next sessions start with: "Resume from docs/STATUS.md and continue the current milestone."
