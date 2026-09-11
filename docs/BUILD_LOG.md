# Build log

The public record of a crew at work. Each session adds an entry, newest first. Keep it honest and short.
Never include private data or secrets.

## Entry format

```text
### YYYY-MM-DD · <milestone> · session N
Lead: Claude Code (<model>) · Teammates: <n> Codex agents (<model>)
Built:
- <what>: by <lead | codex:<agent-name>> · prompt: .fanout/prompts/<file>.md · review changed: <what and why>
Verified by the lead: <checks run and results, e.g. typecheck ok · 142 tests pass · demo green>
Could not verify: <anything, or "nothing">
Next: <the next step>
```

---

### 2026-09-11 · Foundation · session 0

Lead: Claude Code (Opus) · Teammates: none yet

Built:
- The foundation documents (README, AGENTS/CLAUDE rules, vision, product, architecture, adapters contract, roadmap,
  playbook, decisions, status, kickoff): by the lead, from a design conversation with the owner.
- The `codex-fanout` skill copied into `.claude/skills/`. It was proven in another project, where Codex agents ran
  audits, a simulator, two UI rebuilds and several logic passes in parallel under Claude's review.

Verified by the lead: documents cross-checked against each other; no code yet.
Could not verify: the CLI flags in ADAPTERS.md (session 1 verifies them on the owner's machine).
Next: session 1, P0 milestone 1 (see KICKOFF.md).
