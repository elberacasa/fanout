---
name: codex-fanout
description: Fan out GPT agents through the Codex CLI from Claude Code instead of spawning Claude subagents. Use when a task splits into independent pieces (audits, builders, test writers, UI work) that can run in parallel in isolated copies of the repo, and the main session should review and merge their work. Not for single lookups or one-file edits.
---

# Fan out Codex (GPT) agents from Claude Code

The main Claude session stays the architect and the reviewer. Helpers are GPT agents run from the shell with the
Codex CLI (`codex exec`), each in its own copy of the repository. Nothing a helper writes lands until the main session
has read it, merged it on purpose, and run the real tests.

**Never fan out Claude subagents (the Agent tool or workflows) for this.** They spend the user's Claude quota. Do
small single lookups yourself.

## 0 · Before the first agent

- `which codex && codex --version && codex login status` must show the CLI is installed and signed in. If not, ask the
  user to run `codex login`. Never handle their credentials yourself.
- Know the project's real checks, and write them into every prompt: type-check, unit tests, the browser smoke test,
  the mobile build.
- Pick a scratch directory outside the repo, for example the session scratchpad, and call it `$S` below.

## 1 · Decide the shape of the work

| Shape | When | Isolation |
|---|---|---|
| **Auditor** (read-only) | Map a system, find bugs, write a spec or plan | `git archive` copy, `-s read-only` |
| **Builder** | Implement a well-specified change with tests | its own `git worktree`, `-s workspace-write` |
| **Test writer** | Write tests for a new rule before or while you build it | its own worktree |
| **Contract first, then UIs** | The server shape is yours; agents build clients on it | one worktree per client |

- Run agents **in parallel only when they touch disjoint files.** When two need the same files, merge the first, then
  start the second from the new commit.
- A good sequence: an auditor writes the spec, you or a builder implement the core, then builders do the UIs in
  parallel.

## 2 · Create the agent's copy

```bash
S=/path/to/scratch
# Editing agent: its own worktree and branch, dependencies linked rather than reinstalled.
git worktree add -q -b agent-x "$S/agent-x" main
ln -s "$PWD/node_modules" "$S/agent-x/node_modules"      # adjust to the project's dependency folder(s)

# Read-only agent: a plain copy of just what it needs (no .git, no private folders).
mkdir -p "$S/audit" && git archive main README.md docs src | tar -x -C "$S/audit"
```

- Private data never goes to an agent raw: customer chats, personal details, credentials, `.env`, keys. Gitignored
  folders don't appear in a worktree or an archive, which is the point.
- If an agent truly needs real data, **anonymize it locally first**:
  - replace every name and every long number with invented ones, and remove addresses;
  - make the script **refuse to continue** if any original name or number survives;
  - hand over only that copy, kept outside the repo.

## 3 · Write the prompt (to a file)

Ready-made templates ship next to this file: `templates/builder-prompt.md` and `templates/auditor-prompt.md`.

Every prompt has the same parts:

```text
<One line: what this repo is and what you are building.>
Read first: <the rules file (CLAUDE.md or AGENTS.md)>, <the 3–8 exact files that matter>, <the tests to copy the style of>.

TASK
1. <Concrete behaviour, with an example input and the expected output.>
2. ...

HARD RULES
- Never touch <money/security/auth code, migrations, guards>.
- <Domain invariants that must stay true.>
- Invented data only in tests; never copy private text into the repo.
- Keep green: <exact type-check command>, <exact test command>.
- Do not commit and do not create branches.

FINAL MESSAGE
What you changed (files), why, what you deliberately left alone, and the test counts. Say plainly if your sandbox
could not run a check.
```

- Be specific. Name the files, the functions, the routes and the example phrases.
- Say what "done" means. Agents do better with a checklist than with a goal.
- For bug fixes, ask for tests that **fail on the old code**.

## 4 · Launch it (background, with stdin closed)

```bash
codex exec -C "$S/agent-x" -s workspace-write -o "$S/agent-x-report.md" "$(cat "$S/agent-x.md")" \
  < /dev/null > "$S/agent-x.log" 2>&1; echo "exit $?"
# read-only: -C "$S/audit" --skip-git-repo-check -s read-only
```

- Run it with the Bash tool's `run_in_background: true`. You get a notification when it ends, so don't poll.
- Run it **outside Claude Code's sandbox** (`dangerouslyDisableSandbox: true`). Codex applies its own sandbox, and a
  sandbox inside another fails.
- **Always end with `< /dev/null`.** Without a terminal, `codex exec` waits forever on "Reading additional input from
  stdin...".
- Confirm it started: after a few seconds, `grep -m1 "session id" "$S/agent-x.log"` should find a line. If the log only
  says "Reading additional input", stop the task and relaunch with stdin closed.
- Use absolute paths everywhere. Parallel shell calls can change the working directory under you.

## 5 · Know what the agent could not do

The Codex sandbox usually can't open network ports or run heavy toolchains, so browser/e2e smoke tests fail with
`listen EPERM` and `xcodebuild` is blocked. Its "all tests pass" usually means *the tests it could run*. **You run the
full suite and the builds yourself after merging.**

## 6 · Review, then merge on purpose

1. **Read the report, then the diff:**
   `git -C "$S/agent-x" status --short && git -C "$S/agent-x" diff --stat && git -C "$S/agent-x" diff -- <core paths>`.
   Read every change to risky code line by line. Agents add plausible-looking rules that interact badly.
2. **Check the invariants yourself.** Money or consent paths, privacy, anything that picks a default value
   ("never invent a value"), stand-in values that could leak somewhere real.
3. **Merge only what you want:**
   ```bash
   git -C "$S/agent-x" diff -- src tests package.json > "$S/agent-x.patch"
   git apply -3 "$S/agent-x.patch"            # 3-way: survives your own commits since the agent started
   cp "$S/agent-x/path/to/new-file.ts" path/to/   # untracked new files are not in the diff
   grep -rl "<<<<<<<" .                          # conflicts show as markers; resolve them (often the test list)
   ```
   Skip the agent's edits to your status and decision docs. You write those.
4. **Prove bug fixes.** Copy the fixed file aside, restore the old one with `git show HEAD:path > path`, run the new
   test (it must fail), then put the fix back.
5. **If private data was involved,** check that the merged tests don't copy it. Compare every quoted string, in any
   quote style, against the private corpus for exact matches and long shared word runs.
6. **Run the full checks yourself:** type-check, every test, browser smoke tests, mobile builds.
7. **Commit** with a message that says an agent built it and you reviewed it. Then clean up:
   `git worktree remove --force "$S/agent-x" && git branch -D agent-x`.

## 7 · Report to the user

Say what each agent found or built, what you changed during review and why, and the test results you ran yourself.
Say plainly what you could not verify. Never present an agent's "tests pass" as your own verification.

## Checklist

- [ ] Independent pieces, disjoint files, or sequenced when they overlap
- [ ] Worktree or archive per agent; no private data, or anonymized and verified first
- [ ] Prompt names files, examples, hard rules, exact checks, "do not commit", the final report
- [ ] Launched in the background, `< /dev/null`, outside Claude's sandbox, session id confirmed
- [ ] Report and diff read; risky lines reviewed; invariants checked by you
- [ ] Merged with `git apply -3` plus new files copied; conflicts resolved; agent's status docs skipped
- [ ] Bug-fix tests shown to fail on the old code
- [ ] Full suite and builds run by you; committed; worktree and branch removed
