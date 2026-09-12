import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { AdapterManifest } from "../src/schema/manifest.ts";

/*
 * A rule written as data protects nothing until code consults it. Every manifest declared stdin closed while
 * new launch code ignored it; a declaration passing schema validation was mistaken for a promise being kept.
 *
 * This is a structural tripwire, not proof that a reader enforces the rule. Names can belong to other objects,
 * and a top-level reader says nothing about its nested fields. It makes a new field with no reader deliberate:
 * either give it a consumer or explain here why it is only data.
 */
const DATA_ONLY = new Map<string, string>([
  [
    "terms",
    "The vendor terms review is a human shipping decision, not a runtime permission to launch a CLI.",
  ],
  [
    "status",
    "Adapter maturity records release readiness; detection gates on verified versions and sign-in instead.",
  ],
  [
    "tier",
    "Supported, community and reference name our support promise; they do not choose or block a seat.",
  ],
  [
    "stream",
    "The output format documents the adapter contract; headless arguments enable it and each adapter owns its parser.",
  ],
  [
    "network",
    "Network capability is recorded for the seat kit; the safety report currently warns that isolation is not verified.",
  ],
  [
    "usage",
    "Probe and window metadata await quota routing; current usage totals come from adapter stream events instead.",
  ],
]);

function sourceFiles(directory: string): { path: string; text: string }[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    if (!entry.isFile() || !entry.name.endsWith(".ts")) return [];
    return [{ path, text: readFileSync(path, "utf8") }];
  });
}

describe("manifest consumers", () => {
  it("consults every top-level field unless this test says why it need not", () => {
    const packages = fileURLToPath(new URL("../../", import.meta.url));
    const schema = fileURLToPath(new URL("../src/schema/manifest.ts", import.meta.url));
    const sources = readdirSync(packages, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .flatMap((entry) => {
        const directory = join(packages, entry.name);
        return readdirSync(directory, { withFileTypes: true })
          .filter((child) => child.isDirectory() && child.name === "src")
          .flatMap((child) => sourceFiles(join(directory, child.name)));
      })
      .filter((file) => file.path !== schema);

    expect(sources.length, "an empty source scan must never look like coverage").toBeGreaterThan(0);
    for (const field of Object.keys(AdapterManifest.shape)) {
      if (DATA_ONLY.has(field)) continue;
      const escaped = field.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const name = new RegExp(`\\b${escaped}\\b`);
      expect(
        sources.some((file) => name.test(file.text)),
        `AdapterManifest.${field} has no consumer in packages/*/src outside its schema; ` +
          "read it or add a DATA_ONLY entry with a reason worth reading",
      ).toBe(true);
    }
  });

  it("gives a reason for every data-only field and forgets none that were removed", () => {
    const fields = Object.keys(AdapterManifest.shape);
    for (const [field, why] of DATA_ONLY) {
      expect(fields, `${field} is no longer a manifest field`).toContain(field);
      expect(why.trim().length, `${field} needs a reason worth reading`).toBeGreaterThan(40);
    }
  });
});
