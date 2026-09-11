# Status

## Resume here (2026-09-11, session 1)

- **Where we are:** the design is reset around the owner's decisions (DECISIONS 0008–0012): Claude Code is the lead,
  Fanout is a Claude Code plugin plus a vendor-neutral local daemon, Claude as a worker is opt-in, and any agent CLI
  becomes a seat through an adapter. There is still no code.
- **Phase:** P0 · Claude leads, the crew builds. **Next:** milestone 1, Foundations (`docs/ROADMAP.md`). The detailed
  plan is waiting for the owner's approval.
- **Open decisions:**
  1. The final name (DECISIONS 0007). `fanout` is taken on npm; candidates and a check are in the session 1 notes.
  2. Confirm the stack (DECISIONS 0006), including the minimum Node version (Node 20 reached end of life in
     April 2026; the proposal is Node 22+ with the built-in `node:sqlite`).
- **Owner's machine (verified 2026-09-11):** macOS 26.5 arm64, Node 25.6, pnpm 10.28. Agent CLIs: Claude Code
  2.1.269 (signed in, Max), Codex 0.154.0 (signed in, ChatGPT), Kimi Code 0.36.1, Grok Build 1.0.13, Cursor Agent
  2026.01.23 (not signed in). Details in `docs/ADAPTERS.md`.
- **Nothing is public yet.** Pushing to GitHub or publishing needs the owner's word.

## History

- 2026-09-11 · Session 1: competitive research, crew check, design reset to Claude-Code-native (0008–0012).
- 2026-09-11 · Foundation documents written (session 0).
