import { describe, expect, it } from "vitest";
import { AdapterManifest } from "../src/index.ts";

const codex = {
  id: "codex",
  displayName: "OpenAI Codex",
  binary: "codex",
  supportedVersions: ">=0.150.0 <1.0.0",
  headless: {
    args: ["exec", "--json", "-C", "{workdir}", "-s", "{sandbox}", "-o", "{report}", "--", "{prompt}"],
    stdin: "closed",
  },
  stream: { flag: "--json", format: "jsonl" },
  models: ["gpt-6-astra", "gpt-5.6-terra", "gpt-5.6-luna"],
  efforts: ["low", "medium", "high"],
  permissionModes: { readOnly: "read-only", edit: "workspace-write" },
  network: { canDisable: false, flag: null },
  signIn: { probe: ["login", "status"], okPattern: "Logged in" },
  usage: { probe: null, window: "5h" },
  billing: "subscription",
  terms: { reviewedAt: "2026-09-11", notes: "Documented non-interactive mode; no credential handling." },
  status: "alpha",
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
        signIn: { probe: null, okPattern: null },
        status: "research",
      }).success,
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
