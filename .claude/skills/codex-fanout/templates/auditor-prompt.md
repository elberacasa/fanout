<!--
Auditor prompt: a read-only agent working on a `git archive` copy.
Fill every <...> and launch with:
  codex exec -C "$S/<audit>" --skip-git-repo-check -s read-only -o "$S/<audit>-report.md" "$(cat "$S/<audit>.md")" < /dev/null > "$S/<audit>.log" 2>&1
-->
Audit and plan; do not edit. This folder is <one sentence about the system>. Read <rules file> and <the files or
folders in scope>.

The owner's concern: <what feels wrong, in their words>.

REPORT, most important first
1. <What to map: every screen / route / item kind, where it lives (file:line), and what it does.>
2. <What to hunt: dead ends, duplicated work, stale states, actions that need data they don't show, risky defaults.>
3. <What to propose: a target design, grouped by priority, with exact wording where users will read it.>
4. A prioritized plan in small shippable steps (a few hours each), the first three precise enough to implement.

Be concrete and brief; tables are welcome. Your final message is the report.
