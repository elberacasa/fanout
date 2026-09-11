# Security policy

Fanout runs coding agents on your machine, in your repositories, with your subscriptions. Trust is the product, so
security reports get priority over features.

## Reporting a vulnerability

Use GitHub's **private vulnerability reporting** (Security → Report a vulnerability) on this repository. Please
don't open a public issue, and don't include real credentials, customer data or private source in your report; a
minimal synthetic reproduction is enough.

You can expect an acknowledgement within a few days and an honest status, including "we can't fix this and here's
why". Fixes land with a test that fails on the old code, and the advisory credits you unless you prefer otherwise.

## What we consider a vulnerability

- Anything that lets an agent run read or write **outside its declared scope**: escaping its worktree, reaching
  ignored files, `.env` files, credentials or another run's workspace.
- Anything that puts **secrets into a place they don't belong**: an agent's environment, the ledger, a log, a prompt,
  an adapter fixture or a crash report.
- Anything that **merges without the gate**: bypassing review, the project's checks, the proof for a bug fix, or the
  user's approval.
- **Remote reachability**: the daemon's HTTP, WebSocket or MCP surfaces answering anything that is not a local,
  authenticated client, or a web page in a browser being able to drive them.
- Anything that lets a repository, a plan or a CLI's output **execute code** it shouldn't: injection through prompts,
  scenario files, adapter streams or scope patterns.
- **Silent corruption or rewriting of the ledger**, since every claim we make about a run depends on it.

## Known limits (by design, not vulnerabilities)

- **The ledger's append-only guards stop ordinary SQL, not raw file access.** The file belongs to the user; someone
  who can edit it can rewrite history. Opening a ledger checks the guards are present and refuses one that lost them.
- **We cannot stop a secret that a human types into a prompt** or pastes into review notes. Redaction before storage
  is a policy feature, tracked in the architecture doc, not a schema guarantee.
- **We never handle vendor credentials.** Sign-in belongs to each CLI. A problem with a vendor CLI's own credential
  storage should go to that vendor.
- **An agent CLI's sandbox is the vendor's.** We select the safest workable mode a CLI offers and report what it
  could not run; we do not claim to contain a CLI that ignores its own flags.

## Supported versions

Pre-1.0: only the latest release on `main` receives fixes.
