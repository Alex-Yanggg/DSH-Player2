import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    // The body simulator ticks on wall-clock timers; files running side by side starve them.
    fileParallelism: false,
  },
});
