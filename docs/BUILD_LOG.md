# Build log

The public record of a crew at work. Each session adds an entry, newest first. Keep it honest and short.
Never include private data or secrets.

## Entry format

```text
### YYYY-MM-DD · <milestone> · session N
Lead: Claude Code (<model>) · Teammates: <n> Codex agents (<model>)
Built:
- <what>: by <lead | codex:<agent-name>> · prompt: .fanout/prompts/<file>.md · review changed: <what and why>
Verified by the lead: <checks run and results, e.g. typecheck ok · 142 tests pass · demo green>
Could not verify: <anything, or "nothing">
Next: <the next step>
```

---

### 2026-09-13 · v0.9.0, and the loop closed · session 2 (continued)

Lead: Claude Code (Opus 5) · Teammates: 1 Codex agent, launched and merged entirely through the plugin

**The whole loop ran without a driver script for the first time.** `/fanout` in a real Claude Code session
launched a mission; that session ended; the daemon kept the agent working; a different session entirely read the
diff, reviewed it, ran `npm run test` through the gate, proved the new test failed on the old code, and merged
it. `4db85b4` in a scratch repository, authored `codex via fanout`, with `Approved-by` and `Fanout-run` trailers.
Verified by the lead against git rather than taken from the session's report.

The reviewing session also flagged something worth keeping: a discount that does not divide evenly leaves
fractional pennies. It judged that out of scope for the task rather than blocking on it, which is the right call
and not one it was told to make.

Published `v0.9.0`, and verified **from the registry** rather than from the checkout: `npm install fanout-cli`
prints no warnings, the package contains the plugin, its launcher resolves the bundled CLI, and loading that
plugin in a real session exposes all thirteen tools.

Fixed on the way, `82a6824`:
- **"Waiting on you" asked about work that had already been reworked and merged.** A reworked run keeps the
  `rework` verdict that caused the rework, so it can never become mergeable — two were still on the page hours
  after their mission finished, from a repository the reader did not have open. A run with a later attempt on
  the same line is finished with, whatever its own review said.
- Waiting rows now name their repository when it is not the one on screen. One daemon serves the whole machine,
  so an unlabelled row is a request to review work from a project the reader may never have seen.

Verified by the lead: 764 tests (50 files) · CI green · `verify:pack` green · the published package installed
into an empty directory and its plugin loaded in a real session.

Could not verify: nothing.

Next: the 30-second video is the last of P0, and the site is untouched since the owner called its sections
forgettable — both are now the only things left that are not working software.

---

### 2026-09-13 · Missions that outlive their session · session 2 (continued)

Lead: Claude Code (Opus 5) · Teammates: 1 Codex agent, through the plugin, on a scratch repository

P1's first item, done and proven the same day it was written down.

Built:
- **`fanout daemon` runs missions**, `4a3b06a`. One runner per repository, `POST /launch` to hand it work, and
  it answers as soon as the runs are under way because the asker may be gone in thirty seconds. The MCP server
  delegates when a daemon is reachable and runs the mission itself when none is, saying which it did.
- **Cancel reaches a daemon-run mission**, `2c93cd5`, and a mission nobody is running is recorded as cancelled
  rather than left in planning for ever.
- **A dropped run stops counting**, `5a7d11c`.

Verified by the lead: 762 tests · CI green · **a mission launched through the plugin from a `claude -p` session
that then exited, with the agent still working afterwards and the diff finished — `src/cart.js` fixed and a test
added — with no session alive at any point** · a fresh session in that repository afterwards, told by the
SessionStart hook that one run was waiting for review.

Could not verify: nothing.

Four bugs found by building it, three of them worse than the thing being built:

- **`fanout mcp` was writing `daemon.json`.** That file is the machine's one answer to "where is the daemon", and
  every session overwrote it with a short-lived server of its own — so the first thing the new code did was read
  it, find itself, and hand its mission to an API with no runner behind it. The mission sat in planning and never
  started, and the delegation logic would have taken the blame.
- **`fanout daemon` had never written it at all**, so discovery had only ever pointed at whatever ran the demo
  last. An address that outlives the process it names is worse than none: the caller believes it.
- **`cancel_mission` looked only in the local handle map**, so for a daemon-run mission it answered "not running
  here" while the agents carried on spending. Cancel is how somebody stops paying; it is the last control
  allowed to quietly do nothing.
- **`run.dropped` set a status and no end**, so `silentMs` never stopped counting. A real mission read
  `aborted · 1h 24m · 1 quiet` — the run had been over for an hour, nobody was waiting on it, and "quiet" is the
  word this product uses for an agent that has stopped responding.

Worth recording about the product rather than the code: when the earlier orphaned mission failed, the lead
recovered without being asked. It found that a dropped run had in fact completed its work, took that through
review, `run_checks` and `prove_fix` — confirming the new test failed on the old code with `-9000 !== 900` — and
then refused to merge without the owner's word. That is the gate behaving correctly under a failure nobody had
designed for.

Next: ship it. Everything since `v0.8.0` — the plugin in the package, the marketplace, durable missions, and
every fix above — is on `main` and not on npm.

---

### 2026-09-13 · The plugin, used for the first time · session 2 (continued)

Lead: Claude Code (Opus 5) · Teammates: 1 Codex agent, through the plugin

The first time anybody — including us — ran Fanout the way a user will: `claude --plugin-dir`, then `/fanout` in
a real session. Everything before this went through driver scripts straight to the MCP server, which skipped the
plugin, the slash command and the hooks entirely.

**It works.** All thirteen tools were exposed to the session. The lead read the repository, planned one line
(right: the work was one coherent piece), launched it, and said it would review the diff, run the checks through
the gate and use `prove_fix`. The Codex agent wrote a failing test first, ran it, and watched it fail with
`-9000 !== 900` on a real off-by-100 discount bug.

Then it broke, and the way it broke was the point.

**Missions die with the session, and the ledger did not know.** The run log stops mid-work. No `run.finished`, no
`mission.finished`, and `fanout status` reporting `running · 14m 55s` with no agent process alive anywhere. The
supervisor lives inside the session's MCP server; print mode returned after one turn and took the crew with it.

That is not an edge case — it is what happens every time somebody closes a terminal. Without a fix, every
interrupted session leaves a phantom in the ledger for good.

Fixed, `d8c583a`: `run.started` records the supervising process id and every daemon reconciles at startup. The
care is in the refusal — only `ESRCH` counts as death, because `EPERM` means the process belongs to somebody
else and is alive, and a run whose owner is alive belongs to a second terminal and is left strictly alone.
Verified against the real orphan: `running · 14m 55s` became `aborted`.

**`fanout status` was answering the wrong question**, `fb80335`. The ledger is one file per machine, so standing
in a scratch repository it listed work on a website and on Fanout itself. Scoped to the repository the command
was run in, with an honest count of what is elsewhere.

**What is not fixed** is that the work itself is still lost when a session ends. ADR 0024 records why that was a
defensible default — a mission whose lead has gone has nobody to read its diffs — and why it stops being one.
The real answer is moving the runner into `fanout daemon`, which is now the first item of P1.

Verified: 758 tests · CI green · the plugin loaded in a real session and its tools enumerated · reconciliation
run against the live orphaned mission.

---

### 2026-09-13 · The demo, and one package · session 2 (continued)

Lead: Claude Code (Opus 5) · Teammates: none (a design pass is the lead's to own)

The owner said the demo sucked. They were right, and it was worse than unpolished — it was inert.

Built:
- **A live, agent-first demo**, `ab9f29e`: `fanout demo` printed a header, went silent for half a minute while
  three agents worked, then dropped a table of run ids. A row now names the agent, what it was asked for, and
  what it is doing in its own words, redrawn in place. It ends by saying what it was demonstrating.
- **The mission view, same shape**, `a6ebec0`: seven columns to five, and the run id off the front of the row.
- **One package instead of eight**, `726c7cc`: ADR 0023. esbuild bundles the workspace into the CLI at publish
  time. `fanout-cli@0.8.0`, 248 kB, three dependencies.
- `v0.8.0` tagged, released, and published.

Verified by the lead: 743 tests (47 files) · `verify:pack` green · **`npx fanout-cli@0.8.0 demo` run from the
public registry in an empty directory with a fresh HOME, finishing three runs** · the mission view opened in a
browser against a real mission and read back.

Could not verify: nothing.

What this session got wrong, which is the part worth keeping:
- **The demo was never watched.** It had been called done for two sessions. `io.out(header)` then
  `await handle.finished` is thirty seconds of a frozen screen, and no test can see that, because there is
  nothing wrong with the output — there simply is none until the end.
- **The eight-package smell was named and then filed as a nicety.** The lead wrote "nobody will ever install
  `fanout-core` deliberately" and moved on. The cost only became visible when the owner had to touch a
  fingerprint sensor eight times for one release and refused. A defect that is understood and not fixed is
  indistinguishable from one that was missed.
- **Three bugs fell out of the redesign**, all invisible until something was drawn: a finished row was one grid
  cell short so diffs wrapped; a run whose diff was never measured reported "no changes"; and `.diff .add` was
  scoped to a wrapper that had been deleted, so every diff rendered the same grey as the text around it.

Next: the 30-second video, the last of P0. The seven `0.7.0` packages on npm should be deprecated toward
`fanout-cli`.

---

### 2026-09-13 · Published · session 2 (continued)

Lead: Claude Code (Opus 5) · Teammates: none (packaging and naming are the lead's to own)

Built:
- **`v0.7.0` on npm**, eight packages led by `fanout-cli`: by the lead, published by the owner.
- **Renamed to unscoped `fanout-*`**, `6f7d3c7`: the `fanout` org on npm is taken, so `@fanout/*` was never ours
  to have. All eight unscoped names were checked free against the registry before renaming.
- README, STATUS, CHANGELOG and the `v0.7.0` tag brought in line with what is now true.

Verified by the lead: 733 tests (46 files) · CI green · `verify:pack` green after the rename · **and the one that
matters — `npx fanout-cli@0.7.0 demo --once` run from the public registry in an empty directory with a fresh
HOME, finishing three runs.** That is a stranger's install, not ours.

Could not verify: nothing.

What publishing taught us, none of which was in the plan:
- **`pnpm publish` cannot do WebAuthn.** The owner's npm 2FA is a passkey; `pnpm -r publish` fails with `EOTP`
  and no browser. Only `npm` implements the browser flow. The working shape is pnpm to pack — it resolves
  `workspace:*` — and npm to upload the tarballs, in dependency order so `fanout-cli` can never land ahead of
  what it imports.
- **`npm profile get` said `two-factor auth: auth-only`**, which reads as "publishing needs no code". It did.
  Publishing was gated anyway, and the login notice had said so: tokens that bypass 2FA are being restricted for
  direct publishing. A setting that means less than it says is worth knowing about before a release, not during.
- **Eight packages is the honest smell.** Seven exist only because `fanout-cli` imports them, and nobody will ever
  install `fanout-core` on purpose. Bundling them into one package is a real v0.8 option; the cost of having
  published is that all eight stay installable at `0.7.0` forever.

Next: the 30-second video, which is the last of P0 and now has a published product behind it.

---

### 2026-09-12 · A real mission on our own repository · session 2 (continued)

Lead: Claude Code (Opus 5) · Teammates: 2 Codex agents (0.154.0), one rework round each

The P0 acceptance run, done through Fanout rather than around it: plan → safety → parallel launch → rework as
resumed sessions → review → checks → proof → merge, driven over the same stdio MCP transport the plugin uses.

Built and merged:
- **`perf(core)` an incremental projection**, `2d8f9fa`: by codex, reviewed by Claude, reworked once. Callers wrote
  `project(ledger.read())`, decoding every event ever recorded; the MCP server did it per plan line and `/state`
  does it once a second.
- **`fix(mcp)` routing sees a seat that signed in mid-session**, `f1fcb44`: by codex, reviewed by Claude, reworked
  once, **proven by the gate** — its test fails on `11982d6` and passes on the work.

Then, from what the mission exposed:
- **`fix(daemon)` the write scope is enforced, not merely reported**, `7c19f4a`: by the lead. ADR 0022.
- **`fix(mcp)` a reworked run's diff is read from where it actually worked**, `c9052a4`: by the lead.

Verified by the lead: typecheck ok · lint ok · 730 tests pass (45 files) · both merges made by the gate, with
`Built-by`, `Approved-by` and `Fanout-run` trailers · the proof re-run by the gate in a fresh worktree at the base
commit · both new refusals mutation-checked.

Could not verify: CI was still running on `7c19f4a` when this was written.

What the mission found, which nothing else had:
1. **The gate reported scope violations and never enforced them.** `outsideScope` was computed in `collect` and
   used in exactly one place: a line of prose. A run could write anywhere in its worktree and the gate would apply
   it. Both agents wrote to `docs/BUILD_LOG.md`, which neither was granted, and the gate was ready to merge both.
2. **`run_diff` could not find a reworked run's workspace** — a second copy of a rule fixed that same day in
   `locate`. The fifth time this repository has been bitten by one rule with two implementations, and the first
   time the answer was a structural test rather than another careful edit.
3. **Our own rules caused the collision.** `AGENTS.md` told every agent to update the docs; no plan ever granted
   them. Now it tells teammates to stay in scope and tells the lead to grant a doc to one line when it wants one.

Honest notes:
- **The lead wrote a false approval note.** The owner approved in chat, and `merge_run` correctly recorded
  `via: relayed` — but the note said "approved by the owner in the mission view", which is where it did not
  happen. That text was a default baked into the driver script before the owner answered, rather than a quote.
  The ledger is append-only, so it stands and this entry is the correction. The `via` field did its job; the lead
  did not. The driver now refuses to run without a quote.
- **The lead's own planning error caused both rework rounds**: one prompt asked for an export from a file the plan
  had not granted. That is what made finding 1 visible, and it is why widening a scope is deliberate rather than
  forbidden.
- The agents' work was better than specified. The projection's tests check snapshot immutability, an anomaly not
  being recorded twice, and recovery from a failed read — none asked for, all real properties of a resumable fold.

Next: the owner's word to publish to npm, and the 30-second video, which this mission is the material for.

---

### 2026-09-12 · Routing, direct approval, and a publishable package · session 2 (continued)

Lead: Claude Code (Opus 5) · Teammates: none this stretch (each piece was one decision the lead had to own)

Built:
- **Routing wired into real missions** (P0 9), `afcbfdc` `41a8bec`: by the lead. Three rules the wiring itself had
  to get right, each with a test that fails without it — a CLI that cannot report its own sign-in is kept when the
  plan named it and refused only as a fallback; a move carries the seat id and not the model; an unreadable
  `seats.json` moves nothing, because `readSeatPolicy` says its defaults are not safe to act on. The reroute and
  its reason now show on the run's own row.
- **A person approves their own merge** (P0 8), `f9263b1`: by the lead. ADR 0020. `merge_run` recorded
  `by: {kind: "user"}` on the lead's word that it asked, so the fourth non-negotiable was a convention rather than
  a property — an agent that skipped the asking wrote a byte-identical event. Approvals now carry
  `via: direct | relayed`, and `POST /approve` is the daemon's first write route.
- **`fix(daemon)` the last event of a run**, `00fb9d2`: by the lead, from CI. `run.finished` was a bare
  `ledger.append` — the one event in a run with no handling — and threw out of a floating promise when the daemon
  closed its ledger on the way out.
- **The packages can be published**, `ea15f39` `7e63675`: by the lead. ADR 0021.
- **Grok's phase stops going backwards**: by the lead, against the recorded fixture — a community seat, so it cost
  nothing to exercise. The logged debt said the phase never advanced; it does. Reading it properly found the real
  bug beneath the stale note, which all sixteen existing tests passed while it was broken.

Verified by the lead: typecheck ok · lint ok · 719 tests pass (43 files) · `pnpm verify:pack` green (packs,
installs into an empty directory, runs the demo end to end) · the approve button clicked by hand in a browser
against a seeded ledger · CI green on `7e63675`: all six jobs, including the new `installs from empty`.
Could not verify: nothing. Every claim here was read off a run or a command that was looked at.

Honest notes, because each cost real time:
- **`npx fanout-cli` could never have worked.** Node refuses to strip types from any file under `node_modules`
  (`ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING`, reproduced minimally). Publishing raw TypeScript was impossible,
  not merely untidy, and nothing in the repository would ever have said so.
- **Three packaging bugs passed `npm run check` while broken**: runtime assets missing from `files`; a path built
  as a string (`./cli.ts` beside a `cli.js`) that killed all three demo agents on the first spawn; two hand-written
  version strings naming versions that did not exist and disagreeing with each other. All three were found by
  installing the tarball into an empty directory — now `pnpm verify:pack`, and a CI job.
- **A page that redraws itself cannot hold state in the DOM.** The approve button kept "are you sure?" in a
  closure and disarmed itself within 250ms. Found by clicking it, not by reading it.
- **A class name collided** (`.why` already belonged to the claims list) and put "moved:" in front of every piece
  of evidence on the page. The view now has its first test, because it has no build step to catch a typo.

Next: the owner's word to publish (nothing is on npm; `fanout-cli` and `@fanout` are free, bare `fanout` is taken),
then the 30-second video. Debts: all clear. The last one was stale, and looking at it properly found a real bug underneath.

---

### 2026-09-12 · The merge gate, the demo, the view · session 2 (continued)

Lead: Claude Code (Opus 5) · Teammates: codex as the cold reader throughout

Built: the merge gate's mechanics and its five MCP tools; `fanout demo` (offline, no accounts); the mission view
(one HTML file, no framework, ADR 0019); `run.session` so rework has something to resume; the repository made
public, which is also how CI came back.

**What a second vendor, or a second platform, found in the lead's own work:**

- `fanout demo` showed three runs that had each written real files reporting **+0 −0**. New files were counted
  towards the file total and their lines never counted at all. The third instance today of the same shape: git
  says nothing about files it does not track, and code that only asks `git diff` silently misses them.
- The safety gate refused the demo's own plan — `src/api/**` swallowed another line's scope. The best argument for
  that check there is.
- CI on Linux caught a check that could hang the merge gate **forever**: a shell keeps `sleep` as a child, so
  killing the shell leaves a grandchild holding the pipes open. macOS hid it because its shells `exec` the last
  command. Every real check spawns children — that is what `npm test` is.
- CI also caught a lockfile that `pnpm install` had declared up to date and was not, which nothing local checks.

**Changed in review (the lead's own):** a mission view cached in memory so edits did nothing until a restart —
which is how the first version was reviewed against a screen that had not changed; a claim checker that discarded
the reason a run failed and reported a useless "not checked"; a guard for spawning that matched `regex.exec(` and
missed `promisify(execFile)`, wrong in both directions at once.

**Acted on rather than logged again:** four times in one day a rule already settled here was not read by new code
written beside it — the deny-list, the seat policy, `stdin: "closed"`, the detached process group. The seven
places in the daemon that start a process are now listed with a reason each and a test fails when an eighth
appears. It does not make spawning safe; it makes adding one deliberate.

**Corrected:** STATUS claimed "CI green on macOS and Linux" for a whole session during which no job had started —
a billing hold refused every one before it began. Nobody checked. Written only from a run that was looked at.

Next: rework as a resumed session, then routing (P0 · 9) and the video (P0 · 10).

### 2026-09-12 · The claim loop; milestone 7's contract · session 2 (continued)

Lead: Claude Code (Opus 5) · Teammates: codex (gpt-6-astra, high) × 2, plus Codex as the reader for every claim

Built:
- **The merge gate's contract** (`fanout-core`): every step records the `revision` it judged, and `mergeReadiness`
  merges only what review, checks, proof and a person all agreed on — the tie that makes "reviewed and checked"
  mean something when a worktree can move between the two. `merge.approved` answers who authorised a change;
  `merge.applied` records where it landed. `PlanLine.fixesBug` declares a fix when the mission is planned, not
  after an agent has explained why its change is fine.
- **`fanout review`**: a second vendor reads the lead's own uncommitted work, in an isolated copy.
- **`fanout check` and the `check_claims` MCP tool**: the lead states falsifiable claims; a cold reader tries to
  refute each. Cheaper and sharper than broad review, because the asymmetry was never about model quality — the
  lead carries the plan and the reasoning, and that is what hides its mistakes from it.
- **The Stop hook** (`fanout owed`) now covers the lead's own working tree as well as the crew's runs, and
  distinguishes never-checked, checked-at-older-bytes, could-not-run, and refuted-and-unfixed.
- **Zero-install plugin**: `${CLAUDE_PLUGIN_ROOT}` runs the CLI straight out of the checkout. Verified by a fresh
  session started outside the repository with nothing on PATH.
- **Seat posture** (`preferred · normal · sparing · off`) and **capability profiles** for both supported seats.

Verified by the lead: `npm run check` green, **590 tests** (36 files). Resume, fork and review recorded from real
runs on both seats. The zero-install plugin and the `check_claims` tool exercised from real Claude Code sessions.

What the second vendor found, in the lead's own code, this session:
- `Not logged in` matched the pattern for `Logged in`, so a signed-out seat reported as ready. Shipped code.
- Detection could hang forever on one unresponsive CLI and hide every seat that had answered.
- `fanout review` spent the Codex seat without reading the posture setting built thirty minutes earlier.
- An exit code of zero with nothing parsable was reported as "read 12 files and had nothing to say".
- **Four escalating refutations of one claim about symlink isolation**: a copied-in link; a link tracked in HEAD
  that `git worktree add` checks out; a chain (`a -> .` plus `leak -> a/../x`) that `path.resolve` folds away
  lexically while the kernel follows the link first; and finally Node's own JavaScript `realpathSync`, which folds
  `..` lexically *while resolving* — measured on this machine answering `<copy>/etc/passwd` for a link that opens
  the real `/etc/passwd`. Only `realpathSync.native` is a boundary.

Changed in review (the lead's own mistakes, recorded because they are the argument for the product):
- `runSeat` never honoured `stdin: "closed"`, which every manifest declares and the codex-fanout skill warns about
  in bold. `codex exec` blocked for twenty minutes on 0.35s of CPU. Third time this session that a rule written as
  data was not consulted by new code (the deny-list and the seat policy were the others).
- The suite reported 544 passing while a test file was failing to load on a duplicate import.
- The first escape test passed against the broken resolver: it lacked the decoy file that makes the lexical answer
  look real, so the link was cut for the wrong reason.
- A prompt error sent an agent to edit `packages/adapters/fake/manifest.json`, which does not exist; it refused to
  invent one rather than guessing.

Could not verify: CI on GitHub at the time of writing. The `fanout demo` path does not exist yet, so nobody
without a Codex subscription can try any of this.

Honest note: the last claim of the session — that `fanout owed` stays silent on a clean tree with no running
mission — was refuted correctly, and **no code was changed**. A finished mission holding an unreviewed diff is
exactly what is owed; the belief was wrong, not the guard. A refutation says a belief was false. It does not say
whether to change the code or the belief, and a version of this that "fixed" every refutation would have broken a
correct check.

Next: `fanout demo` (offline, no accounts) so the loop can be seen without a subscription; then the rest of
milestone 7 — the checks runner, proof, and `git apply -3`; then Codex writing the failing test from its own
refutation, which is what would make the proof requirement free.

### 2026-09-12 · Scope narrowed; honest progress; capability profiles · session 2

Lead: Claude Code (Opus 5) · Teammates: codex (gpt-6-astra, high) × 1

Built:
- **Scope narrowed to two supported seats** (ADR 0017): Codex and Claude Code driven deep; Grok, Kimi and Cursor
  become community seats whose fixtures keep passing but gate nothing. Propagated to the roadmap, README, vision,
  product, adapters and status. Decided after probing the installed CLIs showed that everything worth having is
  vendor-specific: `codex exec resume` (rework as real session continuation), `codex exec review` (second-vendor
  review, previously P1), `codex exec fork` (best-of-N later), `claude auth status --json` → `subscriptionType`.
  New standing rule in AGENTS.md: build this project on the owner's expensive seats only; never spend a cheap
  subscription on our own tree.
- **Run timing and the quiet signal** (`fanout-core`): by the lead. `RunView` gained `queuedAt`, `startedAt`,
  `endedAt` and `updatedAt`; `elapsedMs` and `silentMs` compute against the caller's clock so a finished run's
  duration never changes while a running one grows. 7 tests, failing first.
- **One renderer for every surface** (`core/src/format/`): by the lead. `mission_status` and the CLI now share it,
  so the chat and the terminal can never disagree. The phase bar shows which named phase a run reported, never how
  complete it is. 11 tests, failing first.
- **Capability profiles in the manifest**: by codex (prompt `agent-capabilities.md`), reviewed by the lead.
  `tier` plus four nullable `capabilities` (resume, fork, review, plan). The plan probe carries a `keep` allowlist
  and the schema proves `planField` is one of it. 21 tests, the agent reported all failing first.

Verified by the lead: `npm run check` green, **410 tests** (25 files), run 11 consecutive times across the session.
The agent's diff read line by line before merging; it invented nothing and said so explicitly.

Changed in review:
- Removed the agent's `fake` manifest test row. My prompt claimed `packages/adapters/fake/manifest.json` exists; it
  does not, and the agent correctly refused to invent one rather than guessing. `docs/ADAPTERS.md` now says the fake
  seat is the one seat with no manifest.
- Updated two inline manifest fixtures (`daemon/test/detector.test.ts`, `mcp/test/mcp.test.ts`) that my prompt had
  fenced off as out of scope; the agent flagged the contradiction instead of working around it.
- Fixed a real bug my own formatter tests caught: `silentMs` reported a **queued** run as quiet for as long as it
  waited in the queue, which would have raised an alarm about the scheduler doing its job. Only a run that has
  started and not ended can be silent.

Could not verify: CI on GitHub (not pushed at the time of writing). The agent could not run `npm run typecheck` or
`npm run test` in its sandbox (zod resolution and a Vite cache `EPERM`); the lead ran both.

Honest note: one `npm run check` failed 2 fake-seat CLI tests mid-session and **never reproduced** in 11 subsequent
runs. The leading hypothesis is stderr ordering — those tests assert stderr starts with `fake seat: `, and Node's
SQLite `ExperimentalWarning` precedes it whenever `NODE_OPTIONS=--disable-warning=ExperimentalWarning` is missing,
which is what happens if the suite is run with `npx vitest` instead of `npm run test`. Not proven, not fixed, and
recorded here rather than dismissed.

Not done: the `keep` allowlist is declared but **nothing enforces it yet** — no code runs the plan probe, so it is a
promise on paper, not a working control. Recorded as a contract gap in `docs/ARCHITECTURE.md`.

Next: run the plan probe behind the allowlist (with a test feeding it an email and an org id), seat posture, then
milestone 7, the merge gate.

### 2026-09-11 · P0 milestone 6, The Claude Code plugin · session 1 (continued)

Lead: Claude Code (Opus 5) · Teammates: none (the tool surface and what it refuses to do stay with the lead)

Built:
- **The mission runner**: a plan becomes runs in dependency order, each in its own worktree, never more at once than
  allowed, with a failed dependency dropping its dependents by reason rather than hope.
- **The MCP server**: seven tools and no more. `launch` refuses a plan the gate blocks unless the user's own words
  are passed as an override, which is recorded with the mission. There is no merge tool at all, and a test asserts
  its absence: the surface is a promise, not a convenience.
- **The plugin**: `/fanout`, `/fanout:crew`, `/fanout:watch`, the lead's skill, and hooks. `claude plugin validate`
  passes.
- **`fanout mcp`**: MCP on stdio plus the daemon in one process, so one process owns the ledger and the live feed
  has something to serve. Everything it prints goes to stderr, because stdout belongs to the protocol.

Verified beyond the tests: JSON-RPC spoken to the real `fanout mcp` over a pipe — it initialises, lists its seven
tools, writes `~/.fanout/daemon.json` (mode 600) and reports the feed URL on stderr.

The commit hook rejected the MCP server's own commit because `mcp` was not a known scope. That is the hook working:
an unknown scope is more likely a typo than a new package. The standard was widened deliberately, in its own commit.

Verified by the lead: typecheck ok · lint ok · **371 tests pass** (24 files) · plugin validated · MCP spoken over a
real pipe · CI green on macOS and Linux, Node 22 and 24.
Could not verify: the plugin inside a live Claude Code session (the owner installs it; the package is not published,
so `fanout` must be linked onto PATH first).
Next: milestone 7, the merge gate — review, the project's checks, proof that a fix fails on the old code, and the
user's approval before `git apply -3`.

### 2026-09-11 · P0 milestone 5, Daemon API + CLI · session 1 (continued)

Lead: Claude Code (Opus 5) · Teammates: none (the API's security model and the CLI's voice stay with the lead)

Built:
- **The daemon's door**: HTTP for the present, a WebSocket for what happens next, on `127.0.0.1` only, with a token
  file only the owner can read, constant-time comparison, and a refusal for anything arriving with a browser's
  Origin. The subscription can be narrowed to one mission or to the events a lead acts on, and replays before it
  goes live. New dependency: `ws` (Node ships a WebSocket client, not a server).
- **The `fanout` CLI**: `status`, `daemon`, `clean`, `version`, `help`.
- **Kimi and Cursor opened as contributions** ([#4](https://github.com/elberacasa/fanout/issues/4),
  [#5](https://github.com/elberacasa/fanout/issues/5)) with everything already verified about each CLI, plus a
  seven-step walkthrough and the bar a seat must meet to merge.

Found by running it for real, not by tests: `fanout status` on the owner's machine reported Grok at **1.0.25**, an
auto-update since its fixture was recorded at 1.0.13 — which the manifest's version range covers, and which is why
manifests declare ranges. `fanout clean` failed at first because git reports resolved paths (`/private/var/…`) while
`FANOUT_HOME` was the symlinked form (`/var/…`), so it removed nothing and then could not delete the branch.

Caught by Dependabot, not by us: the `ws` version was pinned from memory at 8.19.0, which carries a high-severity
denial of service and a medium-severity memory disclosure, both fixed in 8.21.0. It is a runtime dependency, so it
would have shipped. **Check a version against the registry before pinning it**, the same way a CLI's flags are
verified before an adapter trusts them.

Verified by the lead: typecheck ok · lint ok · **354 tests pass** (22 files) · `fanout status` and `fanout help` run
against the real machine · CI green on macOS and Linux, Node 22 and 24.
Could not verify: the daemon under a second concurrent client; `fanout clean` on Windows.
Next: milestone 6, the Claude Code plugin — the MCP tools, the skill, the commands, the hooks and the status line.

### 2026-09-11 · P0 milestone 4, Real seats · session 1 (continued)

Lead: Claude Code (Opus 5) · Teammates: none (each adapter needed a recording only the owner's machine could make)

Built:
- **Adapter manifest** and the **detector**: what a CLI declares about itself, and how the crew finds it, reads its
  version and asks it — through its own status command — whether it is signed in. It answers "unknown" rather than
  guessing, and never reads a credential file.
- **Three seats, each parsed from a real recorded run** on a throwaway repository, scrubbed: Codex 0.154.0,
  Grok Build 1.0.13, Claude Code 2.1.269 (opt-in). 47 contract tests replay those recordings.

What recording taught us that `--help` could not, and each of which changed the code:
- Codex reports **absolute paths** and hides a usage limit inside an ordinary `error` item.
- Grok streams prose in **one-word pieces**, writes no report file, and names its session only in its last line.
- Kimi puts a usage limit on **stderr with a non-zero exit** and nothing in its stream, so `SeatAdapter` gained an
  optional `parseStderr`; a daemon reading only stdout would have called that a plain failure.
- Claude reports **real quota windows** (how full, when they reset), so `AdapterSignal` gained a `quota` kind. Its
  init line also carries the owner's memory paths, skills and slash commands, which the scrub removes.

**Kimi has no adapter.** Its account answered `403 … monthly usage limit for this billing cycle`, so there is no
successful run to record. We did not retry (working around a limit is a non-negotiable) and did not guess a parser
from `--help`.

Verified by the lead: typecheck ok · lint ok · **311 tests pass** (19 files) · CI green on macOS and Linux,
Node 22 and 24 · the privacy scrub checked by grepping each fixture for the owner's home path, account name and
project paths.
Could not verify: Kimi's stream; Cursor (not signed in).
Next: milestone 5, the daemon API and the `fanout` CLI.

### 2026-09-11 · P0 milestone 3, Workspace + safety report · session 1 (continued)

Lead: Claude Code (Opus 5) · Teammates: none (isolation and the launch gate stay with the lead)

Built:
- **The repository went public-ready and private on GitHub** (`elberacasa/fanout`): Conventional Commits enforced by
  a dependency-free hook and by CI, a pre-push hook that refuses to push a red tree, README with badges and an
  honest status table, contributing guide, security policy with our real limits, code of conduct, changelog, issue
  forms, PR checklist, Dependabot. The 21 existing commits were rewritten into the standard before the first push,
  and tagged `v0.1.0` and `v0.2.0`.
- **Workspaces**: a worktree per editing run, an export with no `.git` for auditors, a deny-list checked against the
  base commit, the diff read from the workspace, and cleanup that survives a crash. 12 tests drive real git.
- **The safety gate**: eight checks, each naming the lines it concerns, plus the exact commands that would run.
  20 tests, including one that tries to slip a bad plan past every check at once.
- **Two contract gaps settled** from the milestone 1 audit: a safety report now carries its plan revision (a stale
  one is refused), and scopes accept ordinary filenames (spaces, parentheses, non-ASCII, `app/[id]/page.tsx`).

Reviewed by the lead, in the lead's own work: `collect` diffed against the index, so an agent that staged or
committed would have been under-reported; it now diffs against the base commit, with a test that fails on the old
behaviour. CI caught what local runs could not: the commit-standard job rejected Dependabot's own capitalised
subjects, so bots are exempt and the rule stays strict for people and agents.

Verified by the lead: typecheck ok · lint ok · **221 tests pass** (14 files) · every commit checked on its own ·
CI green on macOS and Linux, Node 22 and 24.
Could not verify: branch protection (GitHub Free does not allow rulesets on private repositories; to be added when
the repository goes public).
Next: milestone 4, real seats — the Codex adapter first, with recorded fixtures and contract tests.

### 2026-09-11 · P0 milestone 2, Fake seat + supervisor · session 1 (continued)

Lead: Claude Code (Opus 5) · Teammates: 3 Codex agents via codex-fanout

Built:
- **Supervisor** (`packages/daemon/src/supervisor/supervise.ts`, 21 tests, 13 `.mjs` fixtures): by
  codex (gpt-6-astra, effort high) · prompt: `.fanout/prompts/m2-supervisor.md` · review changed: `kill(reason)`
  discarded the reason; it is now reported in `RunExit.error`. Everything else merged as written: no inherited
  environment, stdin closed, detached process group, SIGTERM then SIGKILL, log mode 600 with a byte cap,
  multibyte-safe line truncation.
- **Fake seat** (`packages/adapters/fake`): by codex (gpt-5.6-luna, effort medium) · prompt:
  `.fanout/prompts/m2-fake-seat.md` · review changed: **substantially rewritten**. Its own tests failed 3 of 5 when
  the lead ran them (its sandbox could not run vitest); report paths outside the worktree were rejected (every daemon
  run would have exited 65); `hang` exited instead of hanging; `parse()` trusted unvalidated JSON. The lead moved the
  stream format into one zod schema shared by CLI and adapter, switched to `parseArgs` with the prompt after `--`,
  renamed `speed` to `timeScale`, and recorded the fixture from the real CLI with a test that proves it.
- **Adversarial audit of the core** (read-only archive): by codex (gpt-6-astra, effort high) · prompt:
  `.fanout/prompts/m1-core-audit.md` · found 6 real bugs, all fixed by the lead with a failing test first:
  `pathInScope` accepted `src/../private/key`; two valid patterns froze the matcher (a backtracking regex and
  un-memoized recursion — the hang blocked the event loop so hard that vitest could not even time out); the valid id
  `constructor` broke projection lookups; events after a merge or drop resurrected a run; usage could be charged to
  another seat; a row whose routing columns disagreed with its body was returned silently. Its contract gaps are now
  in `docs/ARCHITECTURE.md`.
- **Environment allowlist and run glue** (`packages/daemon/src/env.ts`, `run.ts`): by the lead. Agents get only
  PATH, HOME, locale, TMPDIR and XDG paths. Adapters may only report progress, tools and usage for their own run;
  anything else is refused and surfaced. If the ledger cannot record an event, the run is stopped.

Process note: the supervisor and audit first ran on cheaper models (gpt-5.6-terra / luna). The owner asked for the
strongest model on foundation code; that work was discarded and both were relaunched on gpt-6-astra.

Verified by the lead: typecheck ok · lint ok · **178 tests pass** (11 files) · each commit checked on its own with
`git rebase -x`. The end-to-end test drives the real fake-seat CLI through the real supervisor into a real ledger:
full run, usage limit, hang stopped by the timeout, manual kill.
Could not verify: CI on GitHub (not pushed); Node 22 locally (this machine runs Node 25; CI covers 22 and 24).
Next: milestone 3, workspace + safety report.

### 2026-09-11 · P0 milestone 1, Foundations · session 1

Lead: Claude Code (Opus 5) · Teammates: none yet (milestone 1 is the contract; the lead builds it)

Built:
- Design reset with the owner: competitive research, crew check on the owner's machine (Codex, Claude, Kimi, Grok,
  Cursor verified from `--help` and status commands), Claude Code as the lead (DECISIONS 0008–0014): by the lead.
- Tooling: pnpm workspace, TypeScript 6.0 strict, ESLint strictTypeChecked, Prettier, vitest, `npm run check`, CI
  file (not pushed): by the lead.
- `packages/core`: event, plan and scope schemas (zod), plan validation (cycles, dependencies, read-only auditors,
  overlapping parallel write scopes), the append-only SQLite ledger, pure projections: by the lead.
- Self-review fix: `INSERT OR REPLACE` could overwrite a recorded event without firing the DELETE guard. Added a
  guard trigger; the new test was shown failing on the old code first.
- Prepared, not launched: `.fanout/prompts/m2-supervisor.md`, `.fanout/prompts/m2-fake-seat.md` (builders) and
  `.fanout/prompts/m1-core-audit.md` (an adversarial read-only audit of the core).

Verified by the lead: typecheck ok · lint ok · 107 tests pass (6 files) · every commit checked on its own with
`git rebase -x`.
Could not verify: CI on GitHub (not pushed); Node 22 locally (the machine has Node 25; CI covers 22 and 24).
Honest note: the docs commit `89516e9` has a wrong time in its title (18:05; it was about 17:35). Commit times now
come from `date`.
Next: the owner approves the milestone 2 fan-out; the lead commits the adapter and supervisor contracts, then
launches the three Codex agents.

### 2026-09-11 · Foundation · session 0

Lead: Claude Code (Opus) · Teammates: none yet

Built:
- The foundation documents (README, AGENTS/CLAUDE rules, vision, product, architecture, adapters contract, roadmap,
  playbook, decisions, status, kickoff): by the lead, from a design conversation with the owner.
- The `codex-fanout` skill copied into `.claude/skills/`. It was proven in another project, where Codex agents ran
  audits, a simulator, two UI rebuilds and several logic passes in parallel under Claude's review.

Verified by the lead: documents cross-checked against each other; no code yet.
Could not verify: the CLI flags in ADAPTERS.md (session 1 verifies them on the owner's machine).
Next: session 1, P0 milestone 1 (see KICKOFF.md).

## 2026-09-13 · A proving ground, and the first thing it found

Everything verified so far had been verified in Fanout's own repository or in a throwaway scratch directory.
Neither is a fair test: the first is a codebase every agent working on it already knows, and the second has no
tests, no bug and no checks worth running. So `~/fanout-proving-ground` now exists — a separate repository that
is only there to be worked on.

It is a small task-list CLI: no dependencies, `node --test`, `npm run check` in about a second. Three modules
that do not import each other, so several agents can hold non-overlapping write scopes at once. And, on purpose,
**a real bug in `src/due.ts` that the eighteen passing tests do not catch** — `daysUntil` floors a millisecond
difference, so something due tomorrow at 09:00 reads as "today" when you ask at 10:00, and something a day
overdue reads as two. A repository with no bugs can never exercise the gate's proof condition; this one can.

`docs/SCRIPT.md` there is the acceptance script — five stages, with the specific lie to look for at each gate
condition, and the instruction to change a file in a reviewed worktree and confirm all four conditions expire.
`docs/RUNS.md` is the log.

### What run 0 found

Only the cold-reader path could run: `/fanout` needs a session started after the plugin was installed, and this
one was not — the same restart the website's prompt warns about, met from the inside.

A deliberately *plausible but wrong* fix was planted for the fixture bug (`Math.floor` → `Math.ceil`, which
makes the reported symptom disappear and breaks deadlines later the same day). All 18 tests still passed. Then
`fanout review`.

The review was excellent: it found the regression, gave concrete times, derived the consequence nobody had
mentioned — that `pressing` would drop the task, so `tasks now` breaks its own promise — and noted the tests
pass without covering it. Against a trap written to be tempting, the cold reader held.

**But it cited `/privatesrc/due.ts:18`, a path that does not exist.** `os.tmpdir()` on macOS is `/var/folders/…`
symlinked to `/private/var/folders/…`; the review copy was built at the symlinked spelling, the reviewer
resolved it and emitted the difference. A correct finding nobody can open is close to the worst shape a review
can take, because a reader who cannot find the line stops believing the finding.

Fixed in `8fa859e`: one realpath where the copy is created. The test forces `TMPDIR` through a symlink so it
fails on the old code on every platform rather than only on a Mac — mutation-verified by reverting the fix via
a file copy and watching it fail. Re-run against the fixed build with the same change and the same seat:
`src/due.ts:18-18`.

### Also found, in the harness itself

The acceptance script's own first draft opened with `git reset --hard proving-ground-v1`, which would have
deleted `docs/RUNS.md` — the only thing in that repository that cannot be regenerated — before every run. It now
restores `src test bin` from the tag and never resets. Verified by mutating a source file, restoring, and
confirming the fixture came back with the log intact.

### Verified

`npm run check` in Fanout: 766 tests, 51 files, typecheck and lint clean. `npm run check` in the proving ground:
18 tests, typecheck clean, fixture bug present.

**Still unrun:** the whole plugin path — the setup prompt, `/fanout`, the plan and its scopes, parallel runs,
closing the session mid-run, the merge gate, and the revision rule. That is run 1, and it needs a fresh session.

## 2026-09-13 · The Stop hook stops nagging about other people's repositories

`fanout owed` runs after every turn, which is the point of it — a tool the lead chooses to call cannot catch a
lead who believes the work is already finished. It also means anything it reports, it reports relentlessly.
The logged debt called this "one abandoned mission nags indefinitely". Looking properly, it was two bugs.

**It asked the ledger for every mission on the machine.** The ledger is one file per machine, so a run abandoned
in one project was read out at the end of every turn in every *other* project, for good. `missionLines` had
already learned this exact lesson — `fanout status` in a scratch repository listing work on a website and on
Fanout itself — and the fix never reached the hook, which is the noisier of the two by a long way. Now scoped to
the repository the hook is running in, and still reporting everything when git cannot say where it is standing,
because saying too much beats silence about work that cannot merge.

**There was no way to conclude work you had decided not to do.** Merging ends a run, reworking ends it, a dead
supervisor ends it. "I am not going to bother" had no verb, so the reminder was correct and permanent — and a
permanent reminder is one people learn to ignore. `fanout drop <runId> "why"` is that verb. The reason is
required, and it is recorded as a decision by a person: `reconcile` also writes `run.dropped`, but that is an
inference about a process, and six months later the difference between the two is the whole value of the record.
It refuses a run that is still going rather than writing something the machine can contradict.

The hook's own message had been ending with **"Review them, or drop them on purpose"** for months, advising an
action that did not exist. It now names the command.

### Verified

`npm run check`: 775 tests across 53 files, up nine, typecheck and lint clean. Both fixes have tests that fail
on the old code. Then the loop itself, by hand in two scratch repositories: `owed` reports the run in the repo
that owns it, says nothing in a different repo, `drop` writes it off with a reason, and `owed` goes quiet.
