# Seat adapters

A **seat** is an agent CLI the user has installed and signed in. An **adapter** teaches the daemon to drive that CLI
through its **official non-interactive mode** and to read its output as our events.

## Support tiers (ADR 0017)

Not every seat carries the same promise, and saying so is more honest than a long list of logos.

| Tier | Seats | What it means |
|---|---|---|
| **Supported** | `codex`, `claude` | Driven deep: capability profile recorded, resume and review used, re-verified against a real run on every version bump. Bugs here block a release. |
| **Community** | `grok`, and `kimi`/`cursor` when contributed | The adapter lives here and its contract tests keep passing against recorded fixtures, which costs nothing. Nothing about it gates a release, and we do not spend a subscription on it. |
| **Reference** | `fake` | Not a vendor, and the only seat with no `manifest.json`: it is driven directly by the tests and the demo rather than detected on a machine. It exists to keep the contract honest and to power the offline demo. |

A community seat is promoted by recording its capability profile — not by being popular. Two supported seats is a
deliberate choice: every capability worth having is vendor-specific, so breadth would force us to the lowest common
denominator. The tier is a statement about our verification, never about the CLI's quality.

## Rules (from AGENTS.md, restated because they matter most here)

- Only the vendor's own CLI, the way its documentation describes non-interactive use.
- Never read, copy, store, proxy or reuse credentials or session files. Sign-in state is checked with the CLI's own
  status command, or by a harmless dry call. The user signs in themselves.
- Never bypass rate limits, quotas or regional restrictions. When a seat is limited, route elsewhere or wait.
- **Each provider's terms must be reviewed before its adapter ships.** Record the review (the date and the relevant
  clause) in the adapter's manifest under `terms`.

## The contract

Each adapter lives in `packages/adapters/<cli>/`:

```text
manifest.json    data: what the CLI supports (versioned)
index.ts         code: build the command, parse the stream, probe sign-in and usage
fixtures/        recorded real streams (scrubbed) for contract tests
```

`manifest.json` (fields, first cut):

```jsonc
{
  "id": "codex",
  "displayName": "OpenAI Codex",
  "binary": "codex",
  "supportedVersions": ">=0.150 <1.0",        // outside → "unsupported version", never guess
  "headless": { "command": ["exec", "-C", "{cwd}", "-s", "{sandbox}", "-o", "{reportPath}", "{prompt}"], "stdin": "closed" },
  "stream": { "flag": "--json", "format": "jsonl" },          // null when the CLI has no structured output
  "models": ["…"], "efforts": ["…"],                          // discovered or declared; UI pickers read these
  "permissionModes": { "readOnly": "read-only", "edit": "workspace-write" },
  "network": { "canDisable": true },
  "signIn": { "probe": ["login", "status"] },
  "usage": { "probe": null, "window": "unknown" },           // real usage command if one exists
  "terms": { "reviewedAt": null, "notes": "" },
  "status": "planned"                                          // planned · research · alpha · stable
}
```

The code implements:
- `detect()`: version and sign-in state;
- `command(line, run)`: argv and environment, including the safest flags;
- `parse(chunk)`: the CLI's stream into our events (tool calls, files, phases, usage, the final report);
- `usage()`: real usage when available, otherwise estimated.

**Contract tests** replay every fixture through `parse()` and compare against the expected events. A version bump
means a new fixture recorded, not a guess.

## Integration tracker

Everything below must be verified against the installed CLI's `--help` and its documentation before it's built.
Nothing here is assumed. "Verified" means read from `--help` on the owner's machine on the date shown; stream shapes
still need recorded fixtures.

| Seat | CLI (verified 2026-09-11) | Headless mode | Structured stream | Permissions / sandbox | Sign-in probe | Role · Status |
|---|---|---|---|---|---|---|
| **Fake** | built in (`packages/adapters/fake`) | `node src/cli.ts --scenario-json '<json>' --report <path> -- <prompt>` | JSONL, one object per line (`protocol.ts`) | writes confined to its working directory | n/a | demo + tests · **built** |
| **OpenAI Codex** | `codex` 0.154.0 | `codex exec [prompt]` (stdin must be closed) | `--json` (JSONL) | `-s read-only \| workspace-write`; `-C <dir>`; `-o <file>` last message; `--ephemeral` | `codex login status` ✓ signed in (ChatGPT) | default worker · **supported** |
| **Claude Code** | `claude` 2.1.269 | `claude -p` | `--output-format stream-json` **with `--verbose`** (verified) | `--permission-mode plan \| acceptEdits` with `--permission-prompts none` (deny, never bypass) | `claude auth status --json` ✓ signed in, `subscriptionType` | opt-in worker · **supported** |
| **Kimi Code** (Moonshot) | `kimi` 0.36.1 | `kimi -p <prompt>` — **`--prompt` cannot be combined with `--auto`** (verified) | `--output-format stream-json`; first line is `{"role":"meta","type":"system.version"}` | `--plan` (read-only), `-y` (auto-approve); sandbox: to verify | no status command → reported unknown | **help wanted** ([#4](https://github.com/elberacasa/fanout/issues/4)) |
| **Grok Build** (xAI) | `grok` 1.0.13 | `grok -p <prompt> --cwd <dir>` | `--output-format streaming-json` (session updates) | `--permission-mode plan \| acceptEdits`; `--cwd`; `--max-turns` | no status command → reported unknown; `grok usage` reports a session's tokens and cost | **community** (built, fixture-tested) |
| **Cursor Agent** | `cursor-agent` 2026.01.23 | `cursor-agent -p` | `--output-format stream-json` | `--mode plan\|ask`, `--sandbox enabled`, `--workspace <dir>` | `cursor-agent status` ✗ not signed in | **help wanted** ([#5](https://github.com/elberacasa/fanout/issues/5)) |
| **Gemini** | not installed | `gemini -p` (to verify) | to verify | to verify | to verify | P1 |
| **Qwen Code** | not installed | to verify | to verify | to verify | to verify | P1 |
| **OpenCode** | not installed | to verify | to verify | to verify | to verify | P1 (if it needs API keys, it's an opt-in key seat) |

Notes from the check:
- Never pass a flag that skips the vendor's sandbox or approvals (`--dangerously-*`, `bypassPermissions`,
  `--always-approve` outside a worktree). The safest workable mode per seat is decided in the adapter and shown in the
  safety report.

## What a supported CLI can be told (verified 2026-09-12)

A manifest records the flags to *launch* a run. A **capability profile** records what else the CLI can be asked to do,
because the merge gate and routing are only as good as this table. Verified from `--help` on the owner's machine;
each one needs a recorded run before the daemon relies on it.

| Capability | Codex | Claude Code | Why it matters |
|---|---|---|---|
| Resume a session headlessly | `codex exec resume <id>` / `--last` | to verify | **Rework** replies into the session that wrote the diff instead of re-pasting context into a stranger |
| Fork a session | `codex exec fork <id>` | to verify | Best-of-N from one shared setup (P2) |
| Its own code review | `codex exec review` | to verify | **Second-vendor review** in P0 instead of P1: the worker's vendor reviews, and the lead reviews the reviewer |
| Plan / subscription tier | not exposed — `codex login status` says only "Logged in using ChatGPT" | ✅ `claude auth status --json` → `subscriptionType` | Routing knows which seat is expensive without asking |
| Usage and cost | no probe; a limit arrives inside a mid-run `error` item | real quota windows mid-run (5-hour and 7-day, with resets) | Routing on facts, not estimates |
| Model tiers | `models` list, no cost ordering | to verify | "cheap for boilerplate, top model for foundations" |

> [!IMPORTANT]
> `claude auth status --json` also returns the user's **email, organisation id and organisation name**. The detector
> reads `loggedIn` and `subscriptionType` and discards the rest before anything is stored or logged; the fixture is
> scrubbed and a test greps it. A probe that returns more than we need is normal — keeping more than we need is not.

**Grok's `usage` subcommand** (`grok usage` — persisted token and cost usage for a session) is noted here because it
is the only community seat that reports real cost, which will make it the easiest promotion later.
## Add a seat in an afternoon

A seat is one folder. Nothing else in the daemon changes, which is the point: the crew grows by addition. Take an
open adapter issue (they are labelled `adapter` + `help wanted`) or open one, then:

1. **Verify the CLI, don't assume it.** `which <cli>`, `<cli> --version`, and read `<cli> --help` for four things:
   its non-interactive mode, its structured-output flag, its permission and sandbox flags, and how to ask it whether
   it is signed in. Use the CLI's own status command; never read a credential file.
2. **Record a real run** on a throwaway repository (see below) and scrub it.
3. **Write the manifest** (`manifest.json`): supported versions, the exact argument template, the safest modes, the
   sign-in probe, which pool headless use bills against, and the date you reviewed the vendor's terms. Copy
   `packages/adapters/codex/manifest.json` and change what differs.
4. **Describe the stream** (`src/protocol.ts`) as a zod schema of only the fields you use, with unknown extras
   allowed so a vendor adding a field never breaks a run.
5. **Write `command()` and `parse()`** (`src/index.ts`). `command()` builds the argv from the manifest; `parse()`
   maps one line to events plus signals and **never throws** — an unknown line is an `unparsed` signal, not a guess.
   Make absolute paths repo-relative. If the CLI says anything important on stderr, add `parseStderr`.
6. **Write the contract test** (`test/<cli>.test.ts`): replay the recording and assert the exact events and signals,
   then the awkward cases — garbage input, an unknown line type, a usage limit, a path outside the workspace.
7. **Run `npm run check`** and open a pull request. The checklist in the PR template is the review.

**The bar for merging a seat:** it drives the vendor's own CLI through its documented non-interactive mode; it
touches no credentials; an auditor runs read-only; no flag hands over the machine; a limit is reported as a limit;
what it cannot verify it says it cannot verify; and its parser matches a recording anyone can replay.

`packages/adapters/fake` is the reference implementation, and `codex`, `grok` and `claude` are three real ones that
differ enough to show the range. A contributed seat starts in the **community** tier, which is not a waiting room:
its tests run in CI like everyone else's, and nothing about it is second-class except the promise we make about it.

### Recording a fixture

A contract test replays a stream we actually saw, never one we imagined. To record one:

1. Make a throwaway repository outside this one, with two or three ordinary files and one commit.
2. Run the CLI's non-interactive mode on it with a trivial task ("add a file called hello.txt containing hello,
   then stop"), stdin closed, structured output on, writing the stream to a file. Use the cheapest model and effort:
   a fixture proves the shape of the stream, not the intelligence of the agent.
3. **Scrub it**: replace absolute paths with `/work/sample`, and check every line for anything private. Never record
   against a real project.
4. Commit it as `fixtures/<name>.jsonl` and assert the exact events and signals it produces.

What recording real streams has taught us, and hand-written fixtures would have missed:

- **Codex**: file changes arrive as **absolute paths** (adapters make them repo-relative), and the CLI emits
  non-fatal `error` items mid-run that must reach the lead rather than being swallowed. A usage limit arrives as one
  of those error items, so the adapter tells a limit apart from an ordinary error.
- **Grok**: prose arrives as a stream of one-word deltas and the CLI writes no report file, so the adapter assembles
  the run's report itself; the session id arrives only in the final line.
- **Kimi**: a monthly usage limit arrives on **stderr with a non-zero exit** and nothing in the stream at all. A
  daemon reading only stdout would call that a plain failure, so `SeatAdapter` gained an optional `parseStderr`.
- **Claude Code**: it reports **real quota windows** mid-run (how full the five-hour and seven-day windows are, and
  when each resets), which no other seat does. That is the difference between routing on facts and routing on our
  own estimates, so `AdapterSignal` gained a `quota` kind rather than squeezing a percentage into a token count.
  Its init line also carries the user's own setup (memory paths, skills, slash commands), which the scrub removes.

A new CLI version means a new recording, not an edited one.

**Kimi is waiting on quota, not on us.** On 2026-09-11 the owner's account answered
`403 You've reached your monthly usage limit for this billing cycle`, so no successful run exists to record. We do
not guess a parser from `--help`: the adapter stays unbuilt until a run can be recorded, which is also the rule that
keeps us from shipping a stream we have never seen.

### The fake seat

The built-in simulator is a seat like any other, so it exercises the same contract as a real CLI. A scenario lists
steps (`phase`, `tool` with real file writes, `usage`, `limit`, `sleep`), a report, an exit code, `hang` (keep running
until killed, to test timeouts) and `timeScale` (multiplies every delay: `0.2` for the demo, `0` in tests). Its stdout
is one JSON object per line, defined once in `protocol.ts` and parsed by the adapter. Exit codes: the scenario's own,
`2` after a limit step, `64` for bad arguments or an invalid scenario, `65` for a write outside the working directory,
`70` for anything unexpected. The same scenario always prints the same bytes, and `fixtures/basic.jsonl` is recorded
from the CLI itself, with a test that proves it.

- Every manifest records its **billing pool** (subscription limits, a separate credit, or API) and the terms review.
  Anthropic announced moving `claude -p` to a separate credit on 2026-06-15, then paused it; its help page says
  headless use still draws from subscription limits and that notice will come before any change.

Adding a seat means one folder, one manifest, fixtures and contract tests, the terms review, and a row updated here.
No change anywhere else in the daemon.
