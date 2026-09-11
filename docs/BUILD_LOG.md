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

### 2026-09-11 · P0 milestone 1, Foundations · session 1

Lead: Claude Code (Opus 5) · Teammates: none yet (milestone 1 is the contract; the lead builds it)

Built:
- Design reset with the owner: competitive research, crew check on the owner's machine (Codex, Claude, Kimi, Grok,
  Cursor verified from `--help` and status commands), Claude Code as the lead (DECISIONS 0008–0014): by the lead.
- Tooling: pnpm workspace, TypeScript 6.0 strict, ESLint strictTypeChecked, Prettier, vitest, `npm run check`, CI
  file (not pushed): by the lead.
- `packages/core`: event, plan and scope schemas (zod), plan validation (cycles, dependencies, read-only auditors,
  overlapping parallel write scopes), the append-only SQLite ledger, pure projections: by the lead.
- Self-review fix: `INSERT OR REPLACE` could overwrite a recorded event without firing the DELETE guard. Added a
  guard trigger; the new test was shown failing on the old code first.
- Prepared, not launched: `.fanout/prompts/m2-supervisor.md`, `.fanout/prompts/m2-fake-seat.md` (builders) and
  `.fanout/prompts/m1-core-audit.md` (an adversarial read-only audit of the core).

Verified by the lead: typecheck ok · lint ok · 107 tests pass (6 files) · every commit checked on its own with
`git rebase -x`.
Could not verify: CI on GitHub (not pushed); Node 22 locally (the machine has Node 25; CI covers 22 and 24).
Honest note: the docs commit `89516e9` has a wrong time in its title (18:05; it was about 17:35). Commit times now
come from `date`.
Next: the owner approves the milestone 2 fan-out; the lead commits the adapter and supervisor contracts, then
launches the three Codex agents.

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
