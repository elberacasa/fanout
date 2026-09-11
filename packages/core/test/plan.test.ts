import { describe, expect, it } from "vitest";
import { PlanGraph, validatePlan, type PlanIssueCode } from "../src/index.ts";

type LineInput = PlanGraph["lines"][number];

function line(id: string, overrides: Partial<LineInput> = {}): LineInput {
  return {
    id,
    title: `Line ${id}`,
    role: "builder",
    prompt: `Do ${id}.`,
    seat: { id: "codex" },
    scope: { write: [`src/${id}/**`] },
    dependsOn: [],
    checks: [],
    ...overrides,
  };
}

function plan(...lines: LineInput[]): PlanGraph {
  return PlanGraph.parse({ lines });
}

function codes(graph: PlanGraph): PlanIssueCode[] {
  return validatePlan(graph).map((issue) => issue.code);
}

describe("PlanGraph schema", () => {
  it("fills defaults for dependsOn and checks", () => {
    const parsed = PlanGraph.parse({
      lines: [
        {
          id: "a",
          title: "A",
          role: "builder",
          prompt: "p",
          seat: { id: "codex" },
          scope: { write: ["src/**"] },
        },
      ],
    });
    expect(parsed.lines[0]?.dependsOn).toEqual([]);
    expect(parsed.lines[0]?.checks).toEqual([]);
  });

  it.each([
    ["an uppercase id", { lines: [line("API")] }],
    ["an unknown key", { lines: [{ ...line("a"), extra: true }] }],
    ["no lines", { lines: [] }],
    ["an unknown role", { lines: [line("a", { role: "boss" as never })] }],
    ["an invalid scope", { lines: [line("a", { scope: { write: ["../etc"] } })] }],
    ["a blank title", { lines: [line("a", { title: "   " })] }],
  ])("rejects %s", (_, input) => {
    expect(PlanGraph.safeParse(input).success).toBe(false);
  });
});

describe("validatePlan", () => {
  it("accepts a well-formed plan", () => {
    const graph = plan(
      line("map", { role: "auditor", scope: { write: [] } }),
      line("api", { dependsOn: ["map"] }),
      line("ui", { dependsOn: ["map"] }),
      line("tests", { role: "tester", scope: { write: ["tests/**"] }, dependsOn: ["api"] }),
    );
    expect(validatePlan(graph)).toEqual([]);
  });

  it("reports duplicate ids", () => {
    expect(codes(plan(line("a"), line("a", { scope: { write: ["docs/**"] } })))).toContain("duplicate_line");
  });

  it("reports unknown and self dependencies", () => {
    const graph = plan(line("a", { dependsOn: ["ghost"] }), line("b", { dependsOn: ["b"] }));
    expect(codes(graph)).toEqual(["unknown_dependency", "self_dependency"]);
  });

  it("reports a two-line cycle with its path", () => {
    const [issue] = validatePlan(plan(line("a", { dependsOn: ["b"] }), line("b", { dependsOn: ["a"] })));
    expect(issue?.code).toBe("dependency_cycle");
    expect(issue?.message).toContain("a → b → a");
    expect(issue?.lineIds).toEqual(["a", "b"]);
  });

  it("reports a three-line cycle", () => {
    const graph = plan(
      line("a", { dependsOn: ["c"] }),
      line("b", { dependsOn: ["a"] }),
      line("c", { dependsOn: ["b"] }),
    );
    expect(codes(graph)).toEqual(["dependency_cycle"]);
  });

  it("keeps auditors read-only and builders scoped", () => {
    const graph = plan(
      line("audit", { role: "auditor", scope: { write: ["docs/**"] } }),
      line("build", { scope: { write: [] } }),
      line("test", { role: "tester", scope: { write: [] } }),
    );
    expect(codes(graph)).toEqual(["auditor_writes", "missing_write_scope", "missing_write_scope"]);
  });

  it("refuses parallel lines whose scopes may overlap", () => {
    const issues = validatePlan(
      plan(line("a", { scope: { write: ["src/**"] } }), line("b", { scope: { write: ["src/api/**"] } })),
    );
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ code: "scope_overlap", lineIds: ["a", "b"] });
    expect(issues[0]?.message).toContain('"src/**" / "src/api/**"');
  });

  it("allows the same scope when one line depends on the other", () => {
    const graph = plan(
      line("a", { scope: { write: ["src/**"] } }),
      line("b", { scope: { write: ["src/**"] }, dependsOn: ["a"] }),
    );
    expect(validatePlan(graph)).toEqual([]);
  });

  it("follows transitive dependencies", () => {
    const graph = plan(
      line("a", { scope: { write: ["src/**"] } }),
      line("b", { scope: { write: ["docs/**"] }, dependsOn: ["a"] }),
      line("c", { scope: { write: ["src/**"] }, dependsOn: ["b"] }),
    );
    expect(validatePlan(graph)).toEqual([]);
  });

  it("still checks siblings that wait for the same parent", () => {
    const graph = plan(
      line("parent", { scope: { write: ["lib/**"] } }),
      line("left", { scope: { write: ["src/shared/**"] }, dependsOn: ["parent"] }),
      line("right", { scope: { write: ["src/**"] }, dependsOn: ["parent"] }),
    );
    expect(validatePlan(graph)).toMatchObject([{ code: "scope_overlap", lineIds: ["left", "right"] }]);
  });

  it("reports every issue at once, in a stable order", () => {
    const graph = plan(
      line("a", { scope: { write: ["src/**"] }, dependsOn: ["ghost"] }),
      line("a", { scope: { write: ["docs/**"] } }),
      line("b", { scope: { write: ["src/b/**"] } }),
    );
    const found = codes(graph);
    expect(found).toEqual(["duplicate_line", "unknown_dependency", "scope_overlap"]);
    expect(codes(graph)).toEqual(found);
  });
});
