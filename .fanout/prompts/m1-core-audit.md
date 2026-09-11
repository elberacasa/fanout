<!--
Auditor · P0 milestone 1 · adversarial review of packages/core. Read-only archive.
Prepare: mkdir -p "$S/m1-audit" && git archive main AGENTS.md docs packages/core package.json tsconfig.base.json | tar -x -C "$S/m1-audit"
Launch: codex exec -C "$S/m1-audit" --skip-git-repo-check -s read-only -o "$S/m1-audit-report.md" "$(cat .fanout/prompts/m1-core-audit.md)" < /dev/null > "$S/m1-audit.log" 2>&1
-->
Audit; do not edit. This folder is the core of Fanout: the event and plan schemas (zod), write-scope globs, an
append-only SQLite ledger (node:sqlite) and pure projections. Everything else in the product will trust it. Read
AGENTS.md, docs/ARCHITECTURE.md, and everything under packages/core (src and test).

The lead's concern: this is the contract every later milestone depends on. Find what is wrong before others build on
it. Assume the author was confident and missed things.

REPORT, most important first
1. **Correctness bugs**, each with a concrete input, the wrong result, the expected result, and a failing vitest test
   written out in full (we will add it). Hunt especially in:
   - `scopesMayOverlap` (it must never answer "no" when some path lies in both scopes) and `pathInScope`;
     `isValidScopeGlob` accepting something dangerous or rejecting something reasonable.
   - `validatePlan`: cycles, duplicates combined with dependencies, reachability, issue order stability.
   - The ledger: any way to change or remove a recorded event through SQL (the triggers), transaction handling when
     an insert fails mid-batch, reopening, concurrent writers, WAL, the decode path, error messages.
   - Projections: any event order that produces a wrong state, mutation of a previous state, anomaly handling.
2. **Contract gaps:** events or fields the next milestones (supervisor, adapters, merge gate, mission view; see
   docs/ROADMAP.md) will need and the schema can't express, or constraints that will reject real CLI data.
3. **Honesty and privacy:** anything that could store a secret, a raw log, or claim certainty it doesn't have.
4. A short list of what is solid, so we don't churn it.

Be concrete and brief; file:line references; tables are welcome. Your final message is the report.
