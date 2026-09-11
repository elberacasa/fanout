import { describe, expect, it } from "vitest";
import { ALLOWED_ENV, baseEnv } from "../src/env.ts";

describe("baseEnv", () => {
  it("keeps only what a CLI needs to run and find its own sign-in", () => {
    const source = {
      PATH: "/usr/bin",
      HOME: "/Users/dev",
      LANG: "en_US.UTF-8",
      OPENAI_API_KEY: "sk-invented",
      ANTHROPIC_API_KEY: "invented",
      GITHUB_TOKEN: "invented",
      AWS_SECRET_ACCESS_KEY: "invented",
      NPM_TOKEN: "invented",
    };
    expect(baseEnv(source)).toEqual({ PATH: "/usr/bin", HOME: "/Users/dev", LANG: "en_US.UTF-8" });
  });

  it("drops empty values and leaves the source untouched", () => {
    const source = { PATH: "/usr/bin", TERM: "" };
    const copy = { ...source };
    expect(baseEnv(source)).toEqual({ PATH: "/usr/bin" });
    expect(source).toEqual(copy);
  });

  it("allows no variable that looks like a secret", () => {
    for (const name of ALLOWED_ENV) {
      expect(name).not.toMatch(/KEY|TOKEN|SECRET|PASS|AUTH|CRED/i);
    }
  });
});
