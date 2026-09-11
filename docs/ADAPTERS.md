# Seat adapters

A **seat** is an agent CLI the user has installed and signed in. An **adapter** teaches the daemon to drive that CLI
through its **official non-interactive mode** and to read its output as our events.

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
| **OpenAI Codex** | `codex` 0.154.0 | `codex exec [prompt]` (stdin must be closed) | `--json` (JSONL) | `-s read-only \| workspace-write`; `-C <dir>`; `-o <file>` last message; `--ephemeral` | `codex login status` ✓ signed in (ChatGPT) | default worker · P0 |
| **Claude Code** | `claude` 2.1.269 | `claude -p` | `--output-format stream-json` (`--verbose` to verify) | `--permission-mode` (acceptEdits, auto, dontAsk, plan, …), `--permission-prompts none`, `--restricted`, `--allowedTools` | `claude auth status` ✓ signed in (Max) | opt-in worker · P0 |
| **Kimi Code** (Moonshot) | `kimi` 0.36.1 | `kimi -p <prompt>` | `--output-format stream-json` | `--plan` (read-only), `-y`/`--auto` (auto-approve); sandbox: to verify | no status command; harmless dry call to verify | worker · P0 |
| **Grok Build** (xAI) | `grok` 1.0.13 | `grok -p <prompt>` / `--prompt-file`; `grok agent` | `--output-format streaming-json` (ACP updates) or `streaming-messages-json` | `--permission-mode`, `--sandbox <profile>`, `--cwd`, `--max-turns`, `--disable-web-search` | no status command; harmless dry call to verify | worker · P0 |
| **Cursor Agent** | `cursor-agent` 2026.01.23 | `cursor-agent -p` | `--output-format stream-json` | `--mode plan\|ask`, `--sandbox enabled`, `--workspace <dir>` | `cursor-agent status` ✗ not signed in | worker · P0 when signed in |
| **Gemini** | not installed | `gemini -p` (to verify) | to verify | to verify | to verify | P1 |
| **Qwen Code** | not installed | to verify | to verify | to verify | to verify | P1 |
| **OpenCode** | not installed | to verify | to verify | to verify | to verify | P1 (if it needs API keys, it's an opt-in key seat) |

Notes from the check:
- Never pass a flag that skips the vendor's sandbox or approvals (`--dangerously-*`, `bypassPermissions`,
  `--always-approve` outside a worktree). The safest workable mode per seat is decided in the adapter and shown in the
  safety report.
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
