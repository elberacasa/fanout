<!--
Builder prompt: an agent that edits code in its own git worktree.
Fill every <...>, delete what does not apply, save it next to the worktree, and launch with:
  codex exec -C "$S/<agent>" -s workspace-write -o "$S/<agent>-report.md" "$(cat "$S/<agent>.md")" < /dev/null > "$S/<agent>.log" 2>&1
-->
<One sentence: what this repository is and what you are building.>

Read first: <rules file: CLAUDE.md or AGENTS.md>, <3–8 exact files that matter>, and <the tests whose style to copy>.

TASK
1. <Concrete behaviour. Example input → expected output.>
2. <Next behaviour, same shape.>
3. Tests: add <file name> registered in <test list/config>; for each bug, a test that fails on the current code.

HARD RULES
- Never touch <money / auth / security / migrations / guards: name the paths>.
- <Domain invariants that must stay true, one per line.>
- Invented data only in tests; never copy private text into the repository.
- Keep green: `<exact type-check command>` and `<exact test command>`.
- Do not commit and do not create branches.

FINAL MESSAGE
What you changed (files) and why, what you deliberately left alone, and the test counts. Say plainly if your
sandbox could not run a check (for example browser tests or native builds).
