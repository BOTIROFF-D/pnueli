import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Fault-injection runs explore hundreds of schedules each, and a shared CI
    // runner is several times slower than a laptop.
    testTimeout: 120_000,
    hookTimeout: 120_000,
  },
});
