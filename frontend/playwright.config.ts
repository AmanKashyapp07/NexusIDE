import { defineConfig, devices } from '@playwright/test';

declare const process: { env: { CI?: string } };

export default defineConfig({
  testDir: '../testing/e2e',
  timeout: process.env.CI ? 60 * 1000 : 45 * 1000,
  expect: {
    timeout: process.env.CI ? 20000 : 10000,
  },
  // Run sequentially (1 worker) to prevent concurrent browser contexts
  // from saturating the CPU and causing timeout failures.
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'off',
    screenshot: 'off',
    video: 'off',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
