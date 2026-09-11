import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["packages/*/test/**/*.test.ts", "packages/adapters/*/test/**/*.test.ts"],
    // This suite spawns real processes and drives real git, so a busy machine (or CI) is slower than a quiet one.
    // The timeout is generous on purpose: a test that fails only under load teaches nobody anything.
    testTimeout: 20_000,
    hookTimeout: 20_000,
    // These files spawn processes and run git; letting every core start its own worker oversubscribes the machine
    // the tests are measuring, and deadline tests are the first to suffer.
    maxWorkers: 4,
  },
});
