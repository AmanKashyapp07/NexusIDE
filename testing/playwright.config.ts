import { defineConfig, devices } from '@playwright/test';

declare const process: { env: { CI?: string; BASE_URL?: string; NEXUS_BASE_URL?: string; PLAYWRIGHT_WORKERS?: string } };

export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.spec.ts',
  timeout: process.env.CI ? 180 * 1000 : 120 * 1000,
  expect: {
    timeout: process.env.CI ? 30000 : 25000,
  },
  fullyParallel: true,
  workers: process.env.PLAYWRIGHT_WORKERS ? parseInt(process.env.PLAYWRIGHT_WORKERS) : '100%',
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
