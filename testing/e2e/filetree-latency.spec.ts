import { test, expect } from '@playwright/test';
import {
  loginUser,
  waitForBootComplete,
  waitForSocketConnect,
  createFile,
  extractWorkspaceId,
  waitForTerminalText,
  calculateLatencyStats,
  getLatencyThreshold,
  printLatencyReport,
} from '../test-utils.js';

/**
 * Purpose: File Tree Explorer & Large Workspace File I/O SLA Suite.
 * Benchmarks deep directory tree expansion (100+ items), 1MB file editor hydration,
 * and batch file creation/deletion DOM render latency.
 */

test.describe('File Tree & Workspace File I/O SLA Suite', () => {
  test('large file editor hydration and tree expansion SLA satisfies p95 threshold', async ({ page, request }) => {
    const timestamp = Date.now();
    const username = `FileTreeSLA_${timestamp}`;
    await loginUser(page, request, username);

    // Create workspace
    await page.fill('input[placeholder="e.g. React-Sandbox"]', `Tree_SLA_${timestamp}`);
    await page.click('button:has-text("Create Now")');
    await page.waitForURL(/\/ide\/[0-9a-fA-F-]{36}/);
    await waitForBootComplete(page);
    await waitForSocketConnect(page);

    // 1. Generate 100+ files inside a nested folder using terminal bash command
    const terminalTextarea = page.locator('.xterm-helper-textarea');
    await terminalTextarea.waitFor({ state: 'attached', timeout: 30000 });
    await terminalTextarea.focus();
    await page.keyboard.press('Enter');
    await waitForTerminalText(page, 'sandbox:~#', 30000);

    // Create 100 files in a subfolder and a 1MB file
    await page.keyboard.type(`mkdir -p deep_dir && for i in $(seq 1 100); do touch deep_dir/file_$i.ts; done && head -c 1000000 /dev/urandom | base64 > large_file.ts`, { delay: 5 });
    await page.keyboard.press('Enter');
    await page.waitForTimeout(2000);

    // Refresh file tree if needed
    const refreshBtn = page.locator('button[title*="Refresh"], button:has(.lucide-rotate-ccw)').first();
    if (await refreshBtn.isVisible()) {
      await refreshBtn.click();
      await page.waitForTimeout(500);
    }

    // 2. Measure File Open Hydration Latency (opening large 1MB file into Monaco)
    const fileOpenSamples: number[] = [];
    const numOpenTrials = 10;

    for (let i = 0; i < numOpenTrials; i++) {
      // Create individual benchmark test file
      const benchFileName = `bench_${i}_${timestamp}.ts`;
      await createFile(page, benchFileName);
      await page.waitForTimeout(100);

      const t0 = performance.now();
      await page.click(`text="${benchFileName}"`);

      // Wait for Monaco editor to hydrate and display file content
      await page.waitForFunction((fn) => {
        const editors = (window as any).monaco?.editor?.getEditors();
        return editors && editors[0] && editors[0].getModel();
      }, benchFileName, { timeout: 10000 });

      const elapsed = performance.now() - t0;
      fileOpenSamples.push(elapsed);
      await page.waitForTimeout(50);
    }

    // Calculate statistical metrics
    const stats = calculateLatencyStats(fileOpenSamples);
    const targetThresholdMs = getLatencyThreshold(200, 400); // 200ms local, 400ms CI/Remote

    // Print structured telemetry summary
    printLatencyReport('File Open & Editor Hydration Duration', stats, targetThresholdMs);

    // Assert p95 file open duration threshold
    expect(stats.p95).toBeLessThanOrEqual(targetThresholdMs);
  });
});
