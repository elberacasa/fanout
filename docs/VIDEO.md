# The 30-second video

The last thing P0 asks for. This is the shot list, what has to be true before recording, and the two takes worth
filming — written so the owner can record without deciding anything on the day.

## What it has to argue

Thirty seconds cannot explain a merge gate. It has to land one idea and leave the rest to the README:

> **The agents you already pay for, working in parallel, and nothing merged until you say so.**

Everything below serves that sentence. Anything that does not is cut.

## Take 1 · The hook (25–30s, no accounts, fully reproducible)

One command, one terminal, no editing except trimming the ends.

```sh
npx fanout-cli demo
```

| Time | On screen | Why it is there |
|---|---|---|
| 0–3s | The command typed, then the header: goal, crew, repo | Establishes there is no setup and nothing to sign into |
| 3–10s | Three agents appear and start working, spinners live | The product, in one frame: parallel, named, doing real things |
| 10–18s | Actions change under each agent — `read src/api/orders.ts`, `edit add the csv writer`, `shell npm run check` | This is the part people have not seen before. Let it breathe |
| 18–22s | Rows turn green with `+13 −0`, `+8 −2`, `+4 −1` | Work arrived, and it is measurable |
| 22–30s | **3 agents wrote 25 lines, each in its own worktree. None of it is merged.** and the four conditions | The turn. The point is what did *not* happen |

The demo takes about 6 seconds of agent time, so it will need slowing or the middle section repeating to fill 30.
Do not speed it up: the value is that it is a real duration, not a montage.

## Take 2 · The proof (for the README and the launch post, not the 30s cut)

The hook is simulated and says so. This is the one that makes it credible, and it is a real mission on this
repository — the one already in the ledger, or a fresh one.

1. `/fanout` in Claude Code, two lines, two Codex agents in parallel.
2. The mission view: both working, then both done.
3. **The gate refusing.** `Review asked for changes, which have not come back.` This is the most important shot
   in either take — it is the only one that proves the claim is enforced rather than described.
4. A rework round: 20 seconds, because the agent resumed its own session rather than starting over.
5. The Approve button, clicked by a person.
6. `git log` showing `Built-by: codex via fanout` and `Approved-by: the repository's owner`.

## Before recording

Run each of these; every one is a thing that has gone wrong on camera before or would have.

```sh
npm run check          # green
npm run verify:pack    # the published package still installs from empty
```

- [ ] **A terminal at least 100 columns wide.** Narrower and the action column truncates to `startin…`, which
      looks broken rather than tight.
- [ ] **A fresh `HOME` for the demo**, or accept that `~/.fanout/demo/shop` is shown (paths are tilde-shortened,
      so your account name is not on screen either way).
- [ ] **Dark terminal, a mono font with good box-drawing** — the spinner is braille (`⠋⠙⠹`) and the phase marks
      are `✓ ✗ ·`. Check they render before you start.
- [ ] **No shell prompt noise.** A prompt with a git branch, a timestamp and a virtualenv name is four things
      competing with the three agents.
- [ ] **`npx` will print its install line on first run.** Run the demo once to warm the cache, then record the
      second run, or the first three seconds are npm rather than Fanout.

## What to say over it, if anything

Nothing, for the 30-second cut. The screen already says `None of it is merged.` — a voice-over repeating it is
the thing that makes a demo feel like an advertisement. If there is a caption, one line:

> Claude Code plans it. Your other agents build it. You decide what lands.

## What not to film

- The browser mission view in the 30-second cut. It is a second surface and a second thing to explain; it belongs
  in take 2 where there is room for it.
- Anything requiring a sign-in. The whole argument of take 1 is that it needs none.
- A sped-up montage. A real six seconds is evidence; a montage is a claim.
