import { defineConfig, devices } from '@playwright/test';

declare const process: { env: { CI?: string; BASE_URL?: string; NEXUS_BASE_URL?: string; PLAYWRIGHT_WORKERS?: string } };

export default defineConfig({
  testDir: '../testing/e2e',
  testMatch: '**/*.spec.ts',
  // Real-network runs against the VM need more time per test
  timeout: process.env.CI ? 180 * 1000 : 120 * 1000,
  expect: {
    // toHaveURL / toBeVisible retries at this interval — raise for real network
    timeout: process.env.CI ? 30000 : 25000,
  },
  // Run fully parallel with maximum available CPU cores for fastest E2E execution
  fullyParallel: true,
  workers: process.env.PLAYWRIGHT_WORKERS ? parseInt(process.env.PLAYWRIGHT_WORKERS) : '100%',
  // Always allow 1 retry — flakiness from Yjs sync latency is real-world,
  // not a bug. A test that passes on retry is still a passing feature.
  retries: process.env.CI ? 2 : 1,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: process.env.NEXUS_BASE_URL || process.env.BASE_URL || 'http://129.154.39.198/ide',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
