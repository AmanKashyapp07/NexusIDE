import { defineConfig } from 'vitest/config';
import path from 'path';

/**
 * Backend Vitest Configuration
 * Runs: backend unit/integration tests + Yjs CRDT tests
 * Files:  testing/*.test.ts   (NOT .spec.ts — those are Playwright E2E)
 */
export default defineConfig({
  test: {
    name: 'backend',
    environment: 'node',
    globals: false,
    testTimeout: 20000,
    hookTimeout: 20000,

    // Run serially — tests start real HTTP servers and share mocked DB pool.
    // Parallel execution causes port conflicts and mock bleed-through.
    fileParallelism: false,
    maxConcurrency: 1,
    maxWorkers: 1,

    // Only pick up backend/Yjs unit tests; E2E .spec.ts belong to Playwright
    include: ['../testing/*.test.ts'],
    exclude: ['**/node_modules/**'],

    reporters: process.env.CI
      ? [['verbose'], ['junit', { outputFile: '../test-results/backend-junit.xml' }]]
      : ['verbose'],

    // Suppress MaxListenersExceededWarning: use forks pool so each test file
    // gets its own process, and bump the listener limit via execArgv.
    pool: 'forks',
    poolOptions: {
      forks: {
        execArgv: ['--max-listeners=100'],
      },
    },

    // Global setup: runs in main process (orchestration-level tasks)
    globalSetup: ['../testing/vitest-global-setup.ts'],

    // Setup files: runs in each worker process — this is where process.setMaxListeners()
    // must be called to suppress MaxListenersExceededWarning in the test worker.
    setupFiles: ['../testing/vitest-worker-setup.ts'],
  },
  resolve: {
    alias: {
      'y-websocket': path.resolve(__dirname, 'node_modules/y-websocket'),
      'yjs': path.resolve(__dirname, 'node_modules/yjs'),
      'ws': path.resolve(__dirname, 'node_modules/ws'),
      'jsonwebtoken': path.resolve(__dirname, 'node_modules/jsonwebtoken'),
      'socket.io-client': path.resolve(__dirname, 'node_modules/socket.io-client'),
      'supertest': path.resolve(__dirname, 'node_modules/supertest'),
    },
  },
});
