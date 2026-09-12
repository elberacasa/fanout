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

/*
 * A real environment, from the machine this was written on: Claude Code running inside Cursor's integrated
 * terminal. An editor injects more than its own name — including a live IPC auth token — and none of it is
 * something another vendor's CLI has any business receiving.
 */
describe("an editor's injected environment", () => {
  const cursorTerminal = {
    PATH: "/usr/bin",
    HOME: "/home/someone",
    TERM_PROGRAM: "vscode",
    GIT_ASKPASS: "/Applications/Cursor.app/Contents/Resources/app/extensions/git/dist/askpass.sh",
    VSCODE_GIT_ASKPASS_MAIN: "/Applications/Cursor.app/.../askpass-main.js",
    VSCODE_GIT_IPC_HANDLE: "/tmp/vscode-git-abc.sock",
    VSCODE_GIT_IPC_AUTH_TOKEN: "not-a-real-token-0000",
    VSCODE_INJECTION: "1",
    ANTHROPIC_API_KEY: "sk-not-a-real-key",
    OPENAI_API_KEY: "sk-not-a-real-key",
  };

  it("hands an agent none of it, because the list says what is allowed and not what is banned", () => {
    const env = baseEnv(cursorTerminal);

    expect(env).toEqual({ PATH: "/usr/bin", HOME: "/home/someone" });
    for (const name of Object.keys(cursorTerminal)) {
      if (name === "PATH" || name === "HOME") continue;
      expect(env).not.toHaveProperty(name);
    }
  });

  it("carries no value from the editor at all, not merely no known names", () => {
    // The guarantee has to survive an editor inventing a variable we have never heard of.
    const values = Object.values(baseEnv({ ...cursorTerminal, SOMETHING_NEW: "leaked" }));
    expect(values).not.toContain("leaked");
    expect(values).not.toContain("not-a-real-token-0000");
  });
});
