import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // The suite proper. `exp/` is measurement rather than verification and
    // runs separately (`npm run exp`) — its tables would be noise in CI, where
    // the timings mean nothing and only the state counts would carry over.
    include: ["test/**/*.test.ts"],
    // Fault-injection runs explore hundreds of schedules each, and a shared CI
    // runner is several times slower than a laptop.
    testTimeout: 120_000,
    hookTimeout: 120_000,
  },
});
