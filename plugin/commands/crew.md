---
description: Show which agent CLIs are installed, signed in and ready to work
---

Call the `seats` tool and report the crew in one short table: seat, version, and whether it is ready.

Be exact about what is not known. A CLI with no way to report sign-in is **unknown**, never "ready". If a seat is
installed but signed out, say the command that fixes it (`codex login`, `cursor-agent login`, and so on). If a seat
is an unsupported version, say which versions this build was verified against rather than guessing that it works.

Then, in one line, say what the crew could take on right now.
