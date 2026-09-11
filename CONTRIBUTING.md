# Contributing

Thank you for looking. Fanout is built in public by a small crew: a lead (Claude Code) that plans and reviews, and
agent teammates that build in isolated worktrees. Humans are very welcome on the same terms.

## Get it running

```sh
git clone <this repository> && cd fanout
corepack enable            # pnpm 10, pinned in package.json
pnpm install
git config core.hooksPath .githooks   # commit format + a check before every push
npm run check              # typecheck + lint + tests; must be green before you commit
```

Node 22.18 or newer (the ledger uses the built-in SQLite, and we run TypeScript without a build step).

## Repository map

| Path | What it is |
|---|---|
| `packages/core` | Event, plan and scope schemas (zod), the append-only ledger, projections, the adapter contract |
| `packages/daemon` | Supervisor, environment allowlist, run glue; workspace, policy, merge gate and API as they land |
| `packages/adapters/*` | One folder per agent CLI: manifest, `command()`, `parse()`, recorded fixtures |
| `docs/` | The truth of the project. `STATUS.md` first, then `VISION`, `PRODUCT`, `ARCHITECTURE`, `ROADMAP` |

## The rules that matter

1. **Subscriptions through official headless modes only.** We run a vendor's own CLI the way its documentation
   describes non-interactive use. We never read, copy, store, proxy or reuse credentials, never call private
   endpoints, and never work around rate limits.
2. **Isolation.** Every editing run works in its own git worktree; auditors get a read-only copy. Agents never
   commit, never touch your branch, and never receive secrets or ignored files.
3. **Nothing merges unreviewed.** Review, the project's checks, proof for bug fixes, then a human's approval.
4. **Local-first.** Code, prompts and the ledger stay on the machine. No telemetry unless you turn it on.
5. **Honest UI and honest docs.** Estimated numbers say "estimated"; unknown states say so; a failed load never looks
   like "nothing to do".

## Changes we accept gladly

- **A new adapter** for an agent CLI with an official non-interactive mode: one folder, a manifest, recorded
  fixtures, contract tests, and the provider's terms reviewed and noted. See `docs/ADAPTERS.md`.
- **Bug fixes with a test that fails on the old code.**
- **Tests, fixtures and docs** for behaviour that already exists.

Before a large change, open an issue describing the problem. The roadmap (`docs/ROADMAP.md`) says what phase we are
in; ideas for later phases are recorded there rather than built early.

## Pull requests

- One idea per commit, each commit green on its own, messages following [docs/COMMITS.md](docs/COMMITS.md).
- `npm run check` passes locally; CI runs it on macOS and Linux, Node 22 and 24.
- Update the doc that describes the behaviour in the same commit.
- If an agent wrote part of it, say so in the commit trailer and in `docs/BUILD_LOG.md`, and say what review changed.
- Never include real user data, credentials or private code in fixtures, prompts or the build log.

## Reporting something sensitive

Please don't open a public issue for a security problem. See [SECURITY.md](SECURITY.md).
