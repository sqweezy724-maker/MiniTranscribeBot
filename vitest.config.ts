import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    testTimeout: 30000,
    hookTimeout: 30000,
    fileParallelism: false, // run test files serially to avoid DB conflicts
    include: ["tests/**/*.test.ts"],
  },
});
