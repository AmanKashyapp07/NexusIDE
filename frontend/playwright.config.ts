import { defineConfig, devices } from '@playwright/test';

declare const process: { env: { CI?: string; BASE_URL?: string } };

export default defineConfig({
  testDir: '../testing/e2e',
  // Real-network runs against the VM need more time per test
  timeout: process.env.CI ? 180 * 1000 : 120 * 1000,
  expect: {
    // toHaveURL / toBeVisible retries at this interval — raise for real network
    timeout: process.env.CI ? 30000 : 25000,
  },
  // Run sequentially (1 worker) to prevent concurrent browser contexts
  // from saturating the CPU and causing timeout failures.
  fullyParallel: false,
  workers: 1,
  // Always allow 1 retry — flakiness from Yjs sync latency is real-world,
  // not a bug. A test that passes on retry is still a passing feature.
  retries: process.env.CI ? 2 : 1,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: process.env.BASE_URL || 'http://localhost:5173',
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
