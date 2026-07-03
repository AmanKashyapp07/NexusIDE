import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: false,
    testTimeout: 15000,
    hookTimeout: 15000,
    // Run all test files in a single worker so the vi.mock hoisting
    // and shared mockQuery state don't cross-contaminate between files.
    fileParallelism: false,
    include: ['src/tests/**/*.test.ts'],
    exclude: ['node_modules/**'],
    reporters: ['verbose'],
  },
});
