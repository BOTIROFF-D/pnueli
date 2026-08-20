import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["exp/**/*.test.ts"],
    // The condition search builds and checks a hundred thousand models.
    testTimeout: 600_000,
    hookTimeout: 600_000,
  },
});
