import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { AdapterManifest } from "../src/index.ts";

const codex = {
  id: "codex",
  displayName: "OpenAI Codex",
  binary: "codex",
  supportedVersions: ">=0.150.0 <1.0.0",
  tier: "supported",
  capabilities: { resume: null, fork: null, review: null, plan: null },
  headless: {
    args: ["exec", "--json", "-C", "{workdir}", "-s", "{sandbox}", "-o", "{report}", "--", "{prompt}"],
    stdin: "closed",
  },
  stream: { flag: "--json", format: "jsonl" },
  models: ["gpt-6-astra", "gpt-5.6-terra", "gpt-5.6-luna"],
  efforts: ["low", "medium", "high"],
  permissionModes: { readOnly: "read-only", edit: "workspace-write" },
  network: { canDisable: false, flag: null },
  signIn: { probe: ["login", "status"], okPattern: "^\\s*Logged in\\b", noPattern: "^\\s*Not logged in\\b" },
  usage: { probe: null, window: "5h" },
  billing: "subscription",
  terms: { reviewedAt: "2026-09-11", notes: "Documented non-interactive mode; no credential handling." },
  status: "alpha",
};

const plan = {
  probe: ["auth", "status", "--json"],
  format: "json",
  keep: ["loggedIn", "subscriptionType"],
  planField: "subscriptionType",
};

describe("AdapterManifest", () => {
  it("accepts a complete manifest", () => {
    const parsed = AdapterManifest.parse(codex);
    expect(parsed.headless.args).toContain("{prompt}");
    expect(parsed.terms.reviewedAt).toBe("2026-09-11");
  });

  it("accepts a CLI that reports no usage and cannot turn off the network", () => {
    expect(
      AdapterManifest.safeParse({
        ...codex,
        usage: { probe: null, window: "unknown" },
        network: { canDisable: false, flag: null },
        signIn: { probe: null, okPattern: null, noPattern: null },
        status: "research",
      }).success,
    ).toBe(true);
  });

  it("rejects a planField that is not in keep", () => {
    const result = AdapterManifest.safeParse({
      ...codex,
      capabilities: { ...codex.capabilities, plan: { ...plan, keep: ["loggedIn"] } },
    });
    expect(result.success).toBe(false);
    expect(result.error?.issues).toContainEqual(
      expect.objectContaining({
        path: ["capabilities", "plan", "planField"],
        message: "planField must be one of keep",
      }),
    );
  });

  it("accepts a planField that is in keep", () => {
    const parsed = AdapterManifest.parse({
      ...codex,
      capabilities: { ...codex.capabilities, plan },
    });
    expect(parsed.capabilities.plan).toEqual(plan);
  });

  it.each(["resume", "fork", "review", "plan"])("rejects a missing %s capability", (key) => {
    const capabilities = Object.fromEntries(
      Object.entries(codex.capabilities).filter(([name]) => name !== key),
    );
    const result = AdapterManifest.safeParse({ ...codex, capabilities });
    expect(result.success).toBe(false);
    expect(result.error?.issues).toContainEqual(expect.objectContaining({ path: ["capabilities", key] }));
  });

  it("accepts explicit null capabilities without inventing a mode", () => {
    expect(AdapterManifest.parse(codex).capabilities).toEqual({
      resume: null,
      fork: null,
      review: null,
      plan: null,
    });
  });

  it("rejects an unknown capability", () => {
    const result = AdapterManifest.safeParse({
      ...codex,
      capabilities: { ...codex.capabilities, guess: null },
    });
    expect(result.success).toBe(false);
    expect(result.error?.issues).toContainEqual(
      expect.objectContaining({ code: "unrecognized_keys", path: ["capabilities"] }),
    );
  });

  it("rejects an unknown tier", () => {
    const result = AdapterManifest.safeParse({ ...codex, tier: "premium" });
    expect(result.success).toBe(false);
    expect(result.error?.issues).toContainEqual(expect.objectContaining({ path: ["tier"] }));
  });

  it.each([
    ["codex", "supported"],
    ["claude", "supported"],
    ["grok", "community"],
    // The fake seat has no manifest: it is driven directly by the tests and the demo rather than detected as a
    // seat on the machine. The "reference" tier exists for it in the vocabulary, not yet in a file.
  ])("accepts the %s manifest with its declared tier", (seat, tier) => {
    const input: unknown = JSON.parse(
      readFileSync(new URL(`../../adapters/${seat}/manifest.json`, import.meta.url), "utf8"),
    );
    expect(AdapterManifest.parse(input).tier).toBe(tier);
  });

  it("never keeps Claude account identity fields in the plan allowlist", () => {
    // The probe returns email, orgId and orgName; we must never store them.
    const input: unknown = JSON.parse(
      readFileSync(new URL("../../adapters/claude/manifest.json", import.meta.url), "utf8"),
    );
    const parsed = AdapterManifest.parse(input);
    expect(parsed.capabilities.plan?.keep).toEqual(["loggedIn", "subscriptionType"]);
    expect(parsed.capabilities.plan?.keep).not.toContain("email");
    expect(parsed.capabilities.plan?.keep).not.toContain("orgId");
    expect(parsed.capabilities.plan?.keep).not.toContain("orgName");
  });

  it.each([
    ["an empty probe", { ...plan, probe: [] }, "probe"],
    [
      "more than ten probe arguments",
      { ...plan, probe: Array.from({ length: 11 }, () => "status") },
      "probe",
    ],
    ["an empty allowlist", { ...plan, keep: [] }, "keep"],
    ["more than five kept fields", { ...plan, keep: [...plan.keep, "a", "b", "c", "d"] }, "keep"],
    ["a non-json plan format", { ...plan, format: "text" }, "format"],
    ["an empty kept field name", { ...plan, keep: [...plan.keep, ""] }, "keep"],
    ["an empty probe argument", { ...plan, probe: [""] }, "probe"],
  ])("rejects %s", (_, input, field) => {
    const result = AdapterManifest.safeParse({
      ...codex,
      capabilities: { ...codex.capabilities, plan: input },
    });
    expect(result.success).toBe(false);
    expect(
      result.error?.issues.some((issue) => issue.path[0] === "capabilities" && issue.path[2] === field),
    ).toBe(true);
  });

  it.each([
    ["an unknown key", { ...codex, sandbox: "off" }],
    ["an uppercase id", { ...codex, id: "Codex" }],
    ["no arguments", { ...codex, headless: { ...codex.headless, args: [] } }],
    ["stdin left open", { ...codex, headless: { ...codex.headless, stdin: "inherit" } }],
    ["an unknown stream format", { ...codex, stream: { flag: "--json", format: "yaml" } }],
    ["an unknown status", { ...codex, status: "shipped" }],
    ["a made-up billing pool", { ...codex, billing: "free" }],
    ["a review date that is not a date", { ...codex, terms: { reviewedAt: "last week", notes: "" } }],
    ["no version range", { ...codex, supportedVersions: "" }],
    ["a missing edit mode", { ...codex, permissionModes: { readOnly: "read-only" } }],
  ])("rejects %s", (_, input) => {
    expect(AdapterManifest.safeParse(input).success).toBe(false);
  });
});
