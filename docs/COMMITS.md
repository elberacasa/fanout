# Commit standard

The log is the first thing a developer reads about this project. Every commit is one idea, green on its own, and
written so that `git log --oneline` reads like a changelog.

## Format

```text
<type>(<scope>): <subject>

<body: why this change exists, what it proves, what it deliberately leaves out. Wrapped at 100 columns.>

<trailers>
```

- **type** — one of `feat`, `fix`, `perf`, `refactor`, `test`, `docs`, `build`, `ci`, `chore`, `revert`.
- **scope** — the package or area: `core`, `daemon`, `fake`, `plugin`, `ui`, `cli`, `docs`, `repo`.
- **subject** — imperative mood ("add", not "added"), lower case, no full stop, 72 characters or fewer including the
  type and scope.
- **body** — optional but expected for anything non-obvious: the reason, the proof (test counts, what failed on the
  old code), and what you chose not to do.
- **breaking change** — `feat(core)!: …` plus a `BREAKING CHANGE: …` trailer explaining the migration.

## Trailers

```text
Co-Authored-By: Claude <model> <noreply@anthropic.com>
Built-by: codex (<model>) via codex-fanout · reviewed by Claude   ← only when agent work is included
Claude-Session: <url>
Refs: #<issue>
```

## Rules

1. **One idea per commit.** A bug fix and a refactor are two commits.
2. **Every commit passes `npm run check` on its own.** Verify a series with
   `git rebase -x 'npm run check' <base>` before pushing.
3. **A bug fix ships with a test that fails on the old code**, and the body says so.
4. **Docs change in the same commit as the behaviour** they describe.
5. **No secrets, no private data, no customer content** in messages, code or fixtures.
6. **Credit honestly.** Agent-built work carries `Built-by:` and the build log records what review changed.

## Examples

```text
fix(core): refuse unresolved paths in write scopes

pathInScope accepted "src/../private/key" as inside "src/**", so a run could have written outside its
scope. Only plain repo-relative paths are inside a scope now. The test fails on the old code.
```

```text
feat(daemon): supervise one agent process safely

Spawns with only the given environment, stdin closed, in its own process group; SIGTERM then SIGKILL
reaches grandchildren. 21 tests with 13 fixture scripts.
```

## Enforcement

`.githooks/commit-msg` checks the format and `.githooks/pre-push` runs the full check. Install both once:

```sh
git config core.hooksPath .githooks
```

CI re-checks the messages of every commit in a pull request, so the standard holds even if a hook is missing.

## Releases

Commits are not numbered; order comes from atomic commits plus tags. Each milestone ends with a semantic-version tag
(`v0.1.0`, `v0.2.0`, …) and a `CHANGELOG.md` entry. Until `v1.0.0` the surface may change between minor versions.
