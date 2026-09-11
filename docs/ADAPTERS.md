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
Nothing here is assumed.

| Seat | CLI | Headless mode (to verify) | Structured stream (to verify) | Status |
|---|---|---|---|---|
| **Fake** | built in | deterministic simulator | our events | P0 |
| **Claude Code** | `claude` | `claude -p "<prompt>"` | `--output-format stream-json` | P0 |
| **OpenAI Codex** | `codex` | `codex exec …` | `--json` | P0 |
| **Gemini** | `gemini` | `gemini -p "<prompt>"` | to verify | P1 |
| **Kimi** | vendor CLI, to identify | to verify | to verify | research |
| **Grok** | vendor CLI, to identify (official only) | to verify | to verify | research |
| **Qwen Code** | `qwen` | to verify | to verify | research |
| **OpenCode** | `opencode` | to verify | to verify | research (check whether it needs API keys: if so, it's an opt-in key seat, not default) |

Adding a seat means one folder, one manifest, fixtures and contract tests, the terms review, and a row updated here.
No change anywhere else in the daemon.
