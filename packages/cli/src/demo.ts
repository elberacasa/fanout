import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { PlanLine } from "@fanout/core";
import type { ScenarioInput } from "@fanout/adapter-fake";

/*
 * A whole mission, on a machine with no accounts on it.
 *
 * Everything here is the real thing except the thinking. Real git worktrees, the real safety gate, the real
 * append-only ledger, real diffs collected from real files — driven by the `fake` seat, which is a genuine CLI
 * speaking the genuine protocol and taking a script instead of a model. Nothing is stubbed out inside the daemon,
 * because a demo that exercised a special path would be a demo of something nobody ships.
 *
 * It is honest about the one thing it cannot do. A cold reader's verdicts need a real second vendor; the demo's
 * are written here, and every surface that shows them says `simulated` out loud. Faking the one claim the product
 * makes would be the single most dishonest thing this repository could contain.
 */

/** A small repository worth changing: three areas, one seeded bug, one commit. */
export function buildDemoRepo(root: string): string {
  rmSync(root, { recursive: true, force: true });
  mkdirSync(join(root, "src", "api"), { recursive: true });
  mkdirSync(join(root, "src", "ui"), { recursive: true });
  mkdirSync(join(root, "docs"), { recursive: true });

  writeFileSync(
    join(root, "src", "api", "orders.ts"),
    "export interface Order {\n  id: string;\n  total: number;\n}\n\n" +
      "export function ordersFor(customer: string): Order[] {\n  return [];\n}\n",
  );
  writeFileSync(
    join(root, "src", "api", "dates.ts"),
    "/** Formats a day. Off by one in December: the bug this demo fixes. */\n" +
      "export function monthOf(date: Date): number {\n  return date.getMonth();\n}\n",
  );
  writeFileSync(join(root, "src", "ui", "table.ts"), "export const columns = ['id', 'total'];\n");
  writeFileSync(join(root, "docs", "orders.md"), "# Orders\n\nThe orders API.\n");
  writeFileSync(
    join(root, "package.json"),
    `${JSON.stringify({ name: "demo-shop", private: true, scripts: { check: "echo ok" } }, null, 2)}\n`,
  );

  const git = (args: string[]): void => {
    execFileSync("git", args, {
      cwd: root,
      stdio: "ignore",
      env: { PATH: process.env["PATH"] ?? "", HOME: process.env["HOME"] ?? "", GIT_CONFIG_NOSYSTEM: "1" },
    });
  };
  git(["init", "--quiet", "-b", "main"]);
  git(["config", "user.email", "demo@example.invalid"]);
  git(["config", "user.name", "Fanout demo"]);
  git(["add", "-A"]);
  git(["commit", "--quiet", "-m", "the shop, before the crew arrives"]);
  return root;
}

export const DEMO_GOAL = "Add CSV export and fix the December date bug";

/**
 * Three lines that touch three different areas.
 *
 * One of them is marked `fixesBug`, which is the flag the merge gate holds to the fourth non-negotiable: that
 * line cannot merge without a test proven to fail on the old code. The demo exists partly to show that refusal.
 */
export function demoLines(): PlanLine[] {
  return [
    {
      id: "api",
      title: "CSV export endpoint",
      role: "builder",
      prompt: "Add GET /orders.csv, streaming rows and escaping quotes.",
      seat: { id: "fake", model: "demo" },
      // Narrowed to the file it writes. `src/api/**` swallowed the dates line's scope, and the safety gate
      // refused the plan — on the product's own demo, which is the best argument for the check there is.
      scope: { write: ["src/api/csv.ts"] },
      dependsOn: [],
      checks: ["npm run check"],
      fixesBug: false,
    },
    {
      id: "dates",
      title: "Fix the December month bug",
      role: "builder",
      prompt: "monthOf() is off by one in December. Fix it and prove it with a test.",
      seat: { id: "fake", model: "demo" },
      scope: { write: ["src/api/dates.ts", "src/api/dates.test.ts"] },
      dependsOn: [],
      checks: ["npm run check"],
      fixesBug: true,
    },
    {
      id: "ui",
      title: "Export button",
      role: "builder",
      prompt: "Add the export column and a button that hits the new endpoint.",
      seat: { id: "fake", model: "demo" },
      scope: { write: ["src/ui/**"] },
      dependsOn: [],
      checks: ["npm run check"],
      fixesBug: false,
    },
  ];
}

/**
 * What each simulated agent does, second by second.
 *
 * `timeScale` is the only dishonesty about time and it is the useful kind: a real run takes minutes and nobody
 * watches a demo for minutes. The phases, the tool calls and the files are what a real run of this shape does.
 */
export function demoScenario(line: PlanLine): ScenarioInput {
  const scenarios: Record<string, ScenarioInput> = {
    api: {
      steps: [
        { phase: "reading", delayMs: 900 },
        { tool: "read", summary: "src/api/orders.ts", delayMs: 700 },
        { phase: "coding", delayMs: 600 },
        {
          tool: "edit",
          summary: "add the csv writer",
          delayMs: 1400,
          write: {
            "src/api/csv.ts":
              "import type { Order } from './orders.ts';\n\n" +
              "/** One row per order. A quote inside a field is doubled, per RFC 4180. */\n" +
              "export function toCsv(orders: Order[]): string {\n" +
              "  const rows = orders.map((order) => `${quote(order.id)},${order.total}`);\n" +
              "  return ['id,total', ...rows].join('\\n');\n}\n\n" +
              "function quote(value: string): string {\n" +
              "  return value.includes(',') || value.includes('\"')\n" +
              '    ? `"${value.split(\'"\').join(\'""\')}"`\n    : value;\n}\n',
          },
        },
        { phase: "testing", delayMs: 900 },
        { tool: "shell", summary: "npm run check", delayMs: 1100 },
        { usage: 3 },
        { phase: "reporting", delayMs: 400 },
      ],
      report: "Added toCsv() with RFC 4180 quoting. Streaming is left for a follow-up.",
      timeScale: 1,
    },
    dates: {
      steps: [
        { phase: "reading", delayMs: 800 },
        { phase: "coding", delayMs: 900 },
        {
          tool: "edit",
          summary: "months are zero-based",
          delayMs: 1200,
          write: {
            "src/api/dates.ts":
              "/** Formats a day. getMonth() is zero-based, which is where December went wrong. */\n" +
              "export function monthOf(date: Date): number {\n  return date.getMonth() + 1;\n}\n",
            "src/api/dates.test.ts":
              "import { monthOf } from './dates.ts';\n\n" +
              "// Fails on the old code: it returned 11 for December.\n" +
              "test('December is the twelfth month', () => {\n" +
              "  expect(monthOf(new Date('2026-12-01'))).toBe(12);\n});\n",
          },
        },
        { phase: "testing", delayMs: 1000 },
        { tool: "shell", summary: "npm run check", delayMs: 900 },
        { usage: 2 },
        { phase: "reporting", delayMs: 400 },
      ],
      report: "monthOf() was zero-based. Fixed, with a test that fails on the old code.",
      timeScale: 1,
    },
    ui: {
      steps: [
        { phase: "reading", delayMs: 1000 },
        { phase: "coding", delayMs: 1500 },
        {
          tool: "edit",
          summary: "export column and button",
          delayMs: 1600,
          write: {
            "src/ui/table.ts": "export const columns = ['id', 'total', 'export'];\n",
            "src/ui/export-button.ts":
              "export function exportButton(): string {\n" +
              "  return '<button data-href=\"/orders.csv\">Export CSV</button>';\n}\n",
          },
        },
        { usage: 4 },
        { phase: "reporting", delayMs: 600 },
      ],
      report: "Added the column and the button.",
      timeScale: 1,
    },
  };

  const scenario = scenarios[line.id];
  if (scenario === undefined) throw new Error(`the demo has no script for line "${line.id}"`);
  return scenario;
}

/**
 * The claim check the demo shows, written here rather than asked of anyone.
 *
 * Marked `simulated` all the way through to the screen. A real check needs a real second vendor and a
 * subscription; inventing one and presenting it as read would be faking the single thing this product claims to
 * do, which is worse than having no demo at all.
 */
export function demoClaims(): {
  claim: string;
  verdict: "confirmed" | "refuted" | "unclear";
  evidence: string;
}[] {
  return [
    {
      claim: "The December fix comes with a test that fails on the old code",
      verdict: "confirmed",
      evidence: "dates.test.ts expects 12; the old monthOf returned 11 · src/api/dates.ts:3",
    },
    {
      claim: "Nothing outside the three declared scopes was touched",
      verdict: "confirmed",
      evidence: "every changed path falls inside a declared write scope",
    },
    {
      claim: "toCsv escapes every field that needs it",
      verdict: "refuted",
      evidence: "a field containing a newline is not quoted · src/api/csv.ts:10",
    },
  ];
}
