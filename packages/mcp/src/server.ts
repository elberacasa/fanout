import { randomBytes } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  missionReport,
  PlanGraph,
  PlanLine,
  project,
  validatePlan,
  type AdapterManifest,
  type Ledger,
  type SeatAdapter,
  type SeatInfo,
} from "@fanout/core";
import {
  checkClaims,
  chooseSeat,
  createSafetyDependencies,
  filesInPatch,
  mergeRun,
  proveFix,
  reworkRun,
  runChecks,
  workSnapshot,
  createMissionRunner,
  createWorkspaceManager,
  detectSeats,
  git,
  lines as splitLines,
  safetyReport,
  zeroSeparated,
  type MissionHandle,
  type RunLimits,
} from "@fanout/daemon";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

/*
 * The lead's tools. Claude Code is the brain; this is the hand it works with.
 *
 * Every tool answers in plain words as well as data, because the lead reads them and so does the person watching.
 * Two rules shape the surface:
 *
 *   - Nothing runs that has not passed the gate. `launch` refuses a red safety report unless the user says
 *     otherwise in so many words, and that override is recorded.
 *   - Nothing merges here at all. Review and merge arrive with the gate; a tool that quietly merged would be the
 *     most dangerous thing in the product.
 */

export interface FanoutMcpOptions {
  ledger: Ledger;
  /** The repository the session is working in. */
  repoRoot: string;
  /** Where run logs, reports and workspaces live, and where the owner's seat preferences are kept. */
  paths: { runs: string; workspaces: string; home?: string };
  /** Seat id to adapter, and the manifests behind them. */
  adapters: ReadonlyMap<string, SeatAdapter>;
  manifests: readonly AdapterManifest[];
  limits: RunLimits;
  /** Injected in tests so nothing needs a CLI installed. */
  execute?: (
    binary: string,
    args: readonly string[],
  ) => Promise<{ stdout: string; stderr: string; exitCode: number }>;
  /** The clock elapsed and quiet times are measured against; injected so tests are not timing-dependent. */
  now?: () => Date;
}

const MissionLimits = { maxParallel: z.int().min(1).max(16).default(3) };

export function createFanoutServer(options: FanoutMcpOptions): McpServer {
  const server = new McpServer(
    { name: "fanout", version: "0.6.0-dev" },
    {
      instructions:
        "Fanout runs the other coding-agent CLIs on this machine as a crew. Plan with `plan_check`, start with " +
        "`launch`, watch with `mission_status`, and read a run's work with `run_diff`. Nothing merges here: review " +
        "the diff yourself and apply it, or wait for the merge gate.",
    },
  );

  const workspaces = createWorkspaceManager({
    repoRoot: options.repoRoot,
    workspaceRoot: options.paths.workspaces,
  });
  /*
   * The crew is read once, when the server starts, and the headroom is read from the ledger every time a line
   * starts. Detection spawns processes and a line should not wait on four CLIs to answer before it can begin;
   * a seat running out, though, is exactly the thing that changes between one line and the next.
   */
  let crew: readonly SeatInfo[] = [];
  void detectSeats({
    manifests: options.manifests,
    ...(options.execute === undefined ? {} : { execute: options.execute }),
  }).then((seats) => {
    crew = seats;
  });

  const runner = createMissionRunner({
    ledger: options.ledger,
    workspaces,
    adapters: options.adapters,
    runsRoot: options.paths.runs,
    limits: options.limits,
    route: (line) => {
      const home = options.paths.home;
      // Without a home there are no seat preferences to honour, and routing without them could spend a seat the
      // owner switched off. The plan's own seat is the choice that can only fail loudly.
      if (home === undefined) return { kind: "keep", seat: line.seat.id };
      return chooseSeat(line.seat.id, {
        home,
        crew,
        headroom: project(options.ledger.read()).headroom,
        now: new Date(),
      });
    },
  });
  const missions = new Map<string, MissionHandle>();

  server.registerTool(
    "seats",
    {
      title: "The crew on this machine",
      description:
        "Which agent CLIs are installed, which version, and whether each is signed in. A seat whose CLI cannot " +
        "tell us is reported as unknown, never as ready.",
      inputSchema: {},
    },
    async () => {
      const seats = await detectSeats({
        manifests: options.manifests,
        ...(options.execute === undefined ? {} : { execute: options.execute }),
      });
      const ready = seats.filter((seat) => seat.supported && seat.signedIn === "yes");
      return text(
        `${ready.length} of ${seats.length} seats are ready.\n` +
          seats
            .map(
              (seat) =>
                `- ${seat.id}: ${seat.version ?? "not installed"}, ` +
                (seat.supported ? seat.signedIn : "unsupported version"),
            )
            .join("\n"),
        { seats },
      );
    },
  );

  server.registerTool(
    "repo_overview",
    {
      title: "A map of this repository",
      description:
        "What is here and where, so a plan can be written without reading every file: the commit the mission " +
        "would start from, whether the tree is clean, the top-level areas by size, and the checks the project runs.",
      inputSchema: {},
    },
    async () => {
      const overview = await repoOverview(options.repoRoot);
      return text(
        `On ${overview.head.slice(0, 7)}${overview.dirty.length > 0 ? ` with ${overview.dirty.length} uncommitted file(s)` : ", clean"}.\n` +
          `Areas: ${overview.areas.map((area) => `${area.path} (${area.files})`).join(", ")}\n` +
          `Checks: ${overview.checks.length > 0 ? overview.checks.join(", ") : "none found"}`,
        overview,
      );
    },
  );

  server.registerTool(
    "plan_check",
    {
      title: "Check a plan before anything runs",
      description:
        "Validates a plan and returns the safety report: overlapping write scopes, anything deny-listed in the " +
        "repository, seats that are missing or signed out, the concurrency limits, and the exact commands that " +
        "would run. Records nothing, so iterate freely.",
      inputSchema: { lines: z.array(PlanLine), ...MissionLimits },
    },
    async ({ lines, maxParallel }) => {
      const plan = PlanGraph.parse({ lines });
      const report = await gate(options, plan, maxParallel);
      const blocking = report.checks.filter((check) => !check.ok && check.severity === "block");
      return text(
        blocking.length === 0
          ? `The plan is ready to launch. ${report.checks.filter((check) => !check.ok).length} warning(s).`
          : `This plan cannot launch yet:\n${blocking.map((check) => `- ${check.message}`).join("\n")}`,
        report,
      );
    },
  );

  server.registerTool(
    "launch",
    {
      title: "Start a mission",
      description:
        "Runs a plan: each line in its own git worktree, in dependency order, never more at once than allowed. " +
        "Refuses a plan whose safety report has a blocking failure unless `override` explains why, which is " +
        "recorded. Returns as soon as the runs are under way; watch with mission_status.",
      inputSchema: {
        goal: z.string().min(1).max(4000),
        lines: z.array(PlanLine),
        ...MissionLimits,
        override: z.string().min(10).max(500).optional(),
      },
    },
    async ({ goal, lines, maxParallel, override }) => {
      const plan = PlanGraph.parse({ lines });
      const issues = validatePlan(plan);
      if (issues.length > 0) {
        return text(`This plan cannot run:\n${issues.map((issue) => `- ${issue.message}`).join("\n")}`, {
          issues,
        });
      }

      const report = await gate(options, plan, maxParallel);
      const blocking = report.checks.filter((check) => !check.ok && check.severity === "block");
      if (blocking.length > 0 && override === undefined) {
        return text(
          `Not launching. The safety report has ${blocking.length} blocking failure(s):\n` +
            `${blocking.map((check) => `- ${check.message}`).join("\n")}\n` +
            "Fix the plan, or pass `override` with the reason if the user has decided to go ahead anyway.",
          report,
        );
      }

      const missionId = missionIdFor(goal);
      const head = (await git(["rev-parse", "HEAD"], { cwd: options.repoRoot })).trim();
      options.ledger.appendAll([
        {
          type: "mission.created",
          missionId,
          goal,
          repo: { root: options.repoRoot, baseCommit: head },
          limits: { maxParallel, timeoutMinutes: Math.ceil(options.limits.timeoutMs / 60_000) },
        },
        { type: "plan.proposed", missionId, plan, by: "lead" },
        { type: "safety.report", missionId, planRevision: 1, ok: report.ok, checks: report.checks },
      ]);

      const handle = runner.launch({ missionId, plan, baseCommit: head, maxParallel });
      missions.set(missionId, handle);
      void handle.finished.then((outcome) => {
        options.ledger.append({
          type: "mission.finished",
          missionId,
          outcome: outcome.failed === 0 && outcome.dropped === 0 ? "completed" : "aborted",
          summary: `${outcome.done} done, ${outcome.failed} failed, ${outcome.dropped} dropped`,
        });
      });

      return text(
        `Mission ${missionId} is running ${plan.lines.length} line(s) from ${head.slice(0, 7)}` +
          `${override === undefined ? "" : `, with the safety report overridden: ${override}`}.`,
        { missionId, baseCommit: head, lines: plan.lines.map((line) => line.id) },
      );
    },
  );

  server.registerTool(
    "mission_status",
    {
      title: "How a mission is going",
      description:
        "Every run of a mission: how long it has been going, which phase it reported, what it touched and how " +
        "it ended. A run still working that has said nothing for a while is marked quiet, which is the " +
        "difference between an agent thinking and an agent that has stopped.",
      inputSchema: { missionId: z.string().min(1) },
    },
    ({ missionId }) => {
      const state = project(options.ledger.read({ missionId }));
      const mission = state.missions[missionId];
      if (mission === undefined) return text(`No mission called ${missionId}.`, { missionId });

      return text(missionReport(mission, (options.now ?? (() => new Date()))()), { mission });
    },
  );

  server.registerTool(
    "run_diff",
    {
      title: "What a run actually changed",
      description:
        "The diff read from the run's own workspace, not the agent's account of it, plus anything it wrote " +
        "outside its declared scope and the report it left.",
      inputSchema: {
        missionId: z.string().min(1),
        runId: z.string().min(1),
        patch: z.boolean().default(false),
      },
    },
    async ({ missionId, runId, patch }) => {
      const state = project(options.ledger.read({ missionId }));
      const run = state.missions[missionId]?.runs[runId];
      if (run === undefined) return text(`No run called ${runId} in ${missionId}.`, { missionId, runId });

      const plan = state.missions[missionId]?.plan;
      const line = plan?.lines.find((entry) => entry.id === run.lineId);
      const workspace = {
        missionId,
        runId,
        kind: "worktree" as const,
        path: join(options.paths.workspaces, missionId, runId),
        branch: `fanout/${missionId}/${runId}`,
        baseCommit: state.missions[missionId]?.repo.baseCommit ?? "",
      };
      if (line === undefined || !existsSync(workspace.path)) {
        return text(`The workspace for ${runId} is gone, so there is nothing left to read.`, { runId });
      }

      const diff = await workspaces.collect(workspace, line);
      const reportPath = join(options.paths.runs, missionId, runId, "report.md");
      const report = existsSync(reportPath) ? readFileSync(reportPath, "utf8").slice(0, 20_000) : null;

      return text(
        `${runId}: ${diff.stat.files} file(s), +${diff.stat.insertions} −${diff.stat.deletions}.` +
          (diff.outsideScope.length > 0 ? `\nOutside its scope: ${diff.outsideScope.join(", ")}` : "") +
          (report === null ? "" : `\n\nIts report:\n${report}`),
        {
          stat: diff.stat,
          newFiles: diff.newFiles,
          outsideScope: diff.outsideScope,
          report,
          ...(patch ? { patch: diff.patch.slice(0, 200_000) } : {}),
        },
      );
    },
  );

  server.registerTool(
    "cancel_mission",
    {
      title: "Stop a mission",
      description: "Stops every run still going and drops the lines that had not started, with the reason.",
      inputSchema: { missionId: z.string().min(1), reason: z.string().min(1).max(500) },
    },
    async ({ missionId, reason }) => {
      const handle = missions.get(missionId);
      if (handle === undefined) return text(`Mission ${missionId} is not running here.`, { missionId });
      await handle.cancel(reason);
      return text(`Stopped ${missionId}: ${reason}`, { missionId });
    },
  );

  /*
   * The tool this whole product exists for.
   *
   * Most of the code in a Claude Code session is written by the lead and reviewed by the lead, and the lead's own
   * context — the plan, the reasoning, the justification — is exactly what hides its mistakes from it. A reader
   * holding only the diff is not smarter, it is differently placed. This is here rather than only in the terminal
   * because a check the lead has to remember to leave the session for is a check the lead will not run.
   */
  server.registerTool(
    "check_claims",
    {
      title: "Have a second vendor try to disprove what you believe",
      description:
        "State what you believe about your own uncommitted changes; another vendor's CLI reads them cold, with " +
        "no knowledge of why you wrote them, and tries to falsify each claim. Run this before telling anyone " +
        'work is done. Write claims that could be proven false — "it works" cannot be checked, "no caller of ' +
        'total() passes fewer than two arguments" can. A claim is only ever reported confirmed when the reader ' +
        "said so explicitly: anything it skipped or garbled comes back unclear, never as a pass.",
      inputSchema: {
        claims: z.array(z.string().trim().min(1).max(500)).min(1).max(10),
      },
    },
    async ({ claims }) => {
      const manifest = options.manifests.find((seat) => seat.capabilities.review !== null);
      if (manifest === undefined) {
        return text("No seat on this machine can read code it did not write.", { ran: false });
      }

      const { event, refuted } = await checkClaims({
        repoRoot: options.repoRoot,
        claims,
        manifest,
        ...(options.execute === undefined ? {} : { execute: seatExecute(options.execute) }),
      });
      options.ledger.appendAll([event]);

      if (!event.ran) {
        // "We could not ask" must never read as "nothing was refuted".
        return text(
          `${manifest.displayName} did not check these claims: ${event.claims[0]?.evidence ?? "unknown"}`,
          { ran: false, claims: event.claims },
        );
      }

      const lines = event.claims.map(
        (claim) =>
          `${{ confirmed: "✓", refuted: "✗", unclear: "?" }[claim.verdict]} ${claim.claim}\n    ${claim.evidence}`,
      );
      const verdict =
        refuted.length > 0
          ? `\n${String(refuted.length)} refuted. Fix these before saying the work is done.`
          : event.claims.some((claim) => claim.verdict === "unclear")
            ? "\nNothing refuted, but some claims could not be checked — that is not the same as fine."
            : "\nAll confirmed.";

      return text(`${manifest.displayName} read your changes cold:\n\n${lines.join("\n")}\n${verdict}`, {
        ran: true,
        refuted: refuted.length,
        claims: event.claims,
      });
    },
  );

  /*
   * The merge gate, as four tools the lead drives in order.
   *
   * They are deliberately separate. Each records the revision it judged, and `merge_run` refuses unless review,
   * checks, proof and approval all named the same one — so a single tool that "reviewed and merged" would be a
   * tool that could skip its own gate. Splitting them is what makes the refusal possible.
   */

  /** Finds a run and its worktree, or explains which part is missing. */
  const locate = (missionId: string, runId: string) => {
    const state = project(options.ledger.read({ missionId }));
    const mission = state.missions[missionId];
    const run = mission?.runs[runId];
    const line = mission?.plan?.lines.find((entry) => entry.id === run?.lineId);
    /*
     * Where the run said it worked, falling back to the convention only for a run that never started. A reworked
     * run continues in the worktree of the attempt before it, so deriving the path from the run id finds nothing
     * for exactly the runs that most need finding.
     */
    if (mission === undefined || run === undefined || line === undefined) return null;
    const path = run.workdir ?? join(options.paths.workspaces, missionId, runId);
    return {
      run,
      line,
      workspace: {
        missionId,
        runId,
        kind: "worktree" as const,
        path,
        branch: `fanout/${missionId}/${runId}`,
        baseCommit: mission.repo.baseCommit,
      },
      exists: existsSync(path),
    };
  };

  const RUN = { missionId: z.string().min(1), runId: z.string().min(1) };

  server.registerTool(
    "review_run",
    {
      title: "Record your verdict on a run's diff",
      description:
        "Records what you decided after reading the diff yourself with `run_diff`. Say what you actually " +
        "checked, not that it looks fine. `rework` sends it back; `reject` ends it. The verdict is tied to the " +
        "diff as it is right now, so if the work changes afterwards this review no longer counts for it.",
      inputSchema: {
        ...RUN,
        verdict: z.enum(["accept", "rework", "reject"]),
        notes: z.string().trim().min(1).max(20_000),
      },
    },
    async ({ missionId, runId, verdict, notes }) => {
      const found = locate(missionId, runId);
      if (found?.exists !== true) return text(`No workspace for ${runId} to review.`, { runId });

      const diff = await workspaces.collect(found.workspace, found.line);
      const revision = (await workSnapshot({ cwd: found.workspace.path })).revision;
      options.ledger.appendAll([
        { type: "review.done", missionId, runId, revision, verdict, notes, by: { id: "claude" } },
      ]);
      return text(
        `Recorded: ${verdict} for ${runId} (${String(diff.stat.files)} file(s) changed).` +
          (verdict === "accept" ? " Next: run_checks." : ""),
        { revision, verdict },
      );
    },
  );

  server.registerTool(
    "run_checks",
    {
      title: "Run the project's own checks against a run's work",
      description:
        "Runs the commands the plan declared for this line, in the run's worktree, and believes the exit codes. " +
        "The agent's own claim that its tests pass is not evidence: it was made by the only party with an " +
        "interest in the answer, inside a sandbox that could not run them properly. A line that declared no " +
        "checks is reported as unverified, never as passing.",
      inputSchema: RUN,
    },
    async ({ missionId, runId }) => {
      const found = locate(missionId, runId);
      if (found?.exists !== true) return text(`No workspace for ${runId} to check.`, { runId });

      // A worktree holds tracked files and nothing else, so the repository lends it node_modules for the length
      // of the check and takes them back afterwards.
      const result = await runChecks({
        cwd: found.workspace.path,
        repoRoot: options.repoRoot,
        commands: found.line.checks,
      });
      options.ledger.appendAll([
        {
          type: "checks.done",
          missionId,
          runId,
          revision: result.revision,
          ok: result.ok,
          summary: result.summary,
          commands: result.commands,
        },
      ]);
      const failing = result.outcomes.find((outcome) => outcome.exitCode !== 0);
      return text(
        `${result.ok ? "✓" : "✗"} ${result.summary}` +
          (failing === undefined ? "" : `\n\n${failing.command}:\n${failing.tail}`),
        { ok: result.ok, revision: result.revision, outcomes: result.outcomes },
      );
    },
  );

  server.registerTool(
    "prove_fix",
    {
      title: "Prove a bug fix by failing its test on the old code",
      description:
        "For a line the plan marked as a bug fix. Checks out the code as it was, copies only this run's tests " +
        "on top of it, and runs them: they must fail. A test that passes on the old code would have passed " +
        "before the fix, so it does not test what was broken. Required before such a line can merge.",
      inputSchema: RUN,
    },
    async ({ missionId, runId }) => {
      const found = locate(missionId, runId);
      if (found?.exists !== true) return text(`No workspace for ${runId} to prove.`, { runId });

      const diff = await workspaces.collect(found.workspace, found.line);
      const revision = (await workSnapshot({ cwd: found.workspace.path })).revision;
      const result = await proveFix({
        repoRoot: options.repoRoot,
        workspacePath: found.workspace.path,
        baseCommit: found.workspace.baseCommit,
        touched: [...diff.newFiles, ...filesInPatch(diff.patch)],
        commands: found.line.checks,
      });

      options.ledger.appendAll([
        { type: "proof.done", missionId, runId, revision, ok: result.ok, failedOnOld: result.failedOnOld },
      ]);
      return text(`${result.ok ? "✓ proven" : "✗ not proven"}: ${result.why}`, {
        ok: result.ok,
        revision,
        tests: result.tests,
      });
    },
  );

  server.registerTool(
    "rework_run",
    {
      title: "Send a diff back to the agent that wrote it",
      description:
        "Continues the conversation that produced this diff, with your review notes as the instruction, in the " +
        "same worktree. Use it after `review_run` with a `rework` verdict. This is worth far more than running " +
        "the line again: the agent still holds its own reasoning about the code, so a note about the header row " +
        "lands on someone who knows which header row. Two rounds, then decide instead of asking a third time.",
      inputSchema: RUN,
    },
    ({ missionId, runId }) => {
      const found = locate(missionId, runId);
      if (found?.exists !== true) return text(`No workspace for ${runId} to rework.`, { runId });

      const adapter = options.adapters.get(found.run.seat.id);
      if (adapter === undefined) {
        return text(`No adapter for ${found.run.seat.id} on this machine.`, { runId });
      }

      const outcome = reworkRun({
        ledger: options.ledger,
        adapter,
        missionId,
        line: found.line,
        run: found.run,
        workspacePath: found.workspace.path,
        runsRoot: options.paths.runs,
        limits: options.limits,
      });
      if (outcome.kind === "refused") return text(`Not reworked: ${outcome.why}`, { started: false });

      // Returns as soon as it is under way, like `launch`: watch it with mission_status.
      return text(
        `${outcome.runId} is picking the work back up where it left off. Watch it with mission_status.`,
        { started: true, runId: outcome.runId },
      );
    },
  );

  server.registerTool(
    "merge_run",
    {
      title: "Merge a run's work into the repository",
      description:
        "The only tool that changes the user's repository, and it refuses unless review, checks, proof and the " +
        "user's approval all judged this exact diff. **Ask the user first, in the chat, and quote their answer " +
        "in `approvedBy`.** Applies with a three-way merge; a conflict is reported and rolled back, never " +
        "forced. Nothing is merged into a tree with uncommitted changes it would touch.",
      inputSchema: {
        ...RUN,
        approvedBy: z
          .string()
          .trim()
          .min(1)
          .max(2000)
          .describe("What the user actually said when they approved this merge, in their own words."),
        message: z
          .string()
          .trim()
          .min(1)
          .max(4000)
          .optional()
          .describe(
            "The commit subject and body, in this repository's own convention — read docs/COMMITS.md or the " +
              "recent log before writing it. A project that enforces a format with a hook will refuse anything " +
              "else, and the gate will not bypass that hook. Trailers naming the seat and the approver are " +
              "added by the gate and are not yours to write.",
          ),
      },
    },
    async ({ missionId, runId, approvedBy, message }) => {
      const found = locate(missionId, runId);
      if (found?.exists !== true) return text(`No workspace for ${runId} to merge.`, { runId });

      const diff = await workspaces.collect(found.workspace, found.line);
      const revision = (await workSnapshot({ cwd: found.workspace.path })).revision;

      /*
       * The approval is recorded before the attempt, so a replay shows the authority even when the merge then
       * hits a conflict. It is recorded as the user's because the user is who this tool asks the lead to ask.
       */
      options.ledger.appendAll([
        { type: "merge.approved", missionId, runId, revision, by: { kind: "user" }, note: approvedBy },
      ]);

      const fresh = project(options.ledger.read({ missionId })).missions[missionId]?.runs[runId];
      if (fresh === undefined) return text(`${runId} vanished between reading and merging.`, { runId });

      const outcome = await mergeRun({
        repoRoot: options.repoRoot,
        workspacePath: found.workspace.path,
        run: fresh,
        line: found.line,
        revision,
        patch: diff.patch,
        newFiles: diff.newFiles,
        ...(message === undefined ? {} : { message }),
      });

      if (outcome.kind === "refused") {
        return text(`Not merged:\n${outcome.why.map((why) => `- ${why}`).join("\n")}`, { merged: false });
      }
      if (outcome.kind === "conflict") {
        options.ledger.appendAll([
          { type: "merge.conflict", missionId, runId, revision, files: outcome.files },
        ]);
        return text(
          `Conflict in ${outcome.files.join(", ")}: ${outcome.why}. Your repository is untouched.`,
          { merged: false, files: outcome.files },
        );
      }

      options.ledger.appendAll([
        { type: "merge.applied", missionId, runId, revision, files: outcome.files, commit: outcome.commit },
      ]);
      return text(`Merged ${runId} as ${outcome.commit.slice(0, 7)}: ${outcome.files.join(", ")}`, {
        merged: true,
        commit: outcome.commit,
        files: outcome.files,
      });
    },
  );

  return server;
}

/** The daemon's seat runner takes a working directory and a deadline; the injected test executor takes neither. */
function seatExecute(execute: NonNullable<FanoutMcpOptions["execute"]>) {
  return (binary: string, args: readonly string[]) => execute(binary, args);
}

/** Every tool answers twice: words for whoever is reading, and data for whatever is next. */
function text(message: string, data: unknown) {
  return {
    content: [{ type: "text" as const, text: message }],
    structuredContent: data as Record<string, unknown>,
  };
}

async function gate(options: FanoutMcpOptions, plan: PlanGraph, maxParallel: number) {
  const seats = await detectSeats({
    manifests: options.manifests,
    ...(options.execute === undefined ? {} : { execute: options.execute }),
  });
  const head = (await git(["rev-parse", "HEAD"], { cwd: options.repoRoot })).trim();
  const commands = Object.fromEntries(
    plan.lines.flatMap((line) => {
      const adapter = options.adapters.get(line.seat.id);
      if (adapter === undefined) return [];
      return [
        [
          line.id,
          adapter.command({
            missionId: "preview",
            runId: `${line.id}-1`,
            line,
            workdir: join(options.paths.workspaces, "preview", line.id),
            reportPath: join(options.paths.runs, "preview", line.id, "report.md"),
            baseEnv: {},
          }),
        ],
      ];
    }),
  );

  return safetyReport(
    {
      plan,
      planRevision: 1,
      repo: { root: options.repoRoot, baseCommit: head },
      seats: Object.fromEntries(seats.map((seat) => [seat.id, seat])),
      commands,
      denyList: [],
      limits: { maxParallel, perSeat: {} },
    },
    createSafetyDependencies({ repoRoot: options.repoRoot }),
  );
}

async function repoOverview(repoRoot: string) {
  const head = (await git(["rev-parse", "HEAD"], { cwd: repoRoot })).trim();
  const dirty = splitLines(await git(["status", "--porcelain"], { cwd: repoRoot })).map((entry) =>
    entry.slice(3),
  );
  const files = zeroSeparated(await git(["ls-files", "-z"], { cwd: repoRoot }));

  const counts = new Map<string, number>();
  for (const file of files) {
    const area = file.includes("/") ? `${file.slice(0, file.indexOf("/"))}/` : "(root)";
    counts.set(area, (counts.get(area) ?? 0) + 1);
  }
  const areas = [...counts.entries()]
    .map(([path, count]) => ({ path, files: count }))
    .sort((a, b) => b.files - a.files)
    .slice(0, 12);

  return { head, dirty, files: files.length, areas, checks: projectChecks(repoRoot) };
}

/** The commands this project runs to know it is well, read from where they are declared. */
function projectChecks(repoRoot: string): string[] {
  const manifest = join(repoRoot, "package.json");
  if (!existsSync(manifest)) return [];
  try {
    const parsed = JSON.parse(readFileSync(manifest, "utf8")) as { scripts?: Record<string, string> };
    return Object.keys(parsed.scripts ?? {})
      .filter((name) => ["check", "test", "lint", "typecheck", "build"].includes(name))
      .map((name) => `npm run ${name}`);
  } catch {
    return [];
  }
}

function missionIdFor(goal: string): string {
  const slug = goal
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
  return `${slug === "" ? "mission" : slug}-${randomBytes(2).toString("hex")}`;
}
