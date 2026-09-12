import { describe, expect, it } from "vitest";
import { versionOf } from "../src/version.ts";

/*
 * Two hand-written version strings had already drifted from the packages they named and from each other. The
 * point of reading it is that it cannot.
 */
describe("what version this is", () => {
  it("reads the version out of the package the caller lives in", () => {
    expect(versionOf(import.meta.url)).toMatch(/^\d+\.\d+\.\d+/);
  });

  it("says unknown rather than inventing a number when there is no package", () => {
    expect(versionOf("file:///")).toBe("unknown");
  });
});
