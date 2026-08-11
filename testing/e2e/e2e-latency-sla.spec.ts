import { test, expect } from '@playwright/test';
import {
  APP_URL, loginUser, inviteUser, waitForBootComplete, focusEditor,
  createFile, getEditorValue, waitForEditorModel, extractWorkspaceId,
  waitForTerminalText, calculateLatencyStats, getLatencyThreshold, printLatencyReport
} from '../test-utils';

test.describe('Deployed Infrastructure SLA - Keystroke Latency & PTY Throughput', () => {
  test.describe.configure({ mode: 'serial' });

  test('1. Keystroke-to-Render (K2R) Latency across WAN peer sessions', async ({ page, context, request }) => {
    const alicePage = page;
    const bobContext = await context.browser()!.newContext();
    try {
      const bobPage = await bobContext.newPage();
      const timestamp = Date.now();
      
      await loginUser(alicePage, request, `Alice_K2R_${timestamp}`);
      await loginUser(bobPage, request, `Bob_K2R_${timestamp}`);

      await alicePage.fill('input[placeholder="e.g. React-Sandbox"]', `K2R_WS_${timestamp}`);
      await alicePage.click('button:has-text("Create Now")');
      await alicePage.waitForURL(/\/ide\/[0-9a-fA-F-]{36}/);
      const workspaceId = extractWorkspaceId(alicePage.url());

      await waitForBootComplete(alicePage);

      // Create latency test file on Alice BEFORE inviting Bob to guarantee tree presence on initial boot
      await createFile(alicePage, 'latency-test.js');
      await waitForEditorModel(alicePage, 'latency-test.js');

      await inviteUser(alicePage, `Bob_K2R_${timestamp}`, 'editor');

      await bobPage.goto(`${APP_URL}/${workspaceId}`, { waitUntil: 'domcontentloaded' });
      await waitForBootComplete(bobPage);

      const bobFileSelector = bobPage.locator('.ide-scrollbar').getByText('latency-test.js');
      await expect(async () => {
        await expect(bobFileSelector).toBeVisible();
      }).toPass({ timeout: 30000, intervals: [1000] });

      await bobFileSelector.click();
      await waitForEditorModel(bobPage, 'latency-test.js');

      // Verify baseline sync setup
      await focusEditor(alicePage);
      await alicePage.keyboard.type('// Baseline Sync\n');
      await expect(async () => {
        const val = await getEditorValue(bobPage);
        expect(val).toContain('Baseline Sync');
      }).toPass({ timeout: 25000, intervals: [200] });

      const targetThreshold = getLatencyThreshold(250, 1200); // Hard SLA threshold: 250ms local, 1200ms WAN edit burst

      // Measure latency samples across edit bursts with precise timestamp delta
      const samples: number[] = [];
      const editChunks = [
        'const alpha = 100;\n',
        'const beta = 200;\n',
        'function computeSum(a, b) {\n',
        '  return a + b;\n',
        '}\n',
      ];

      for (const chunk of editChunks) {
        await focusEditor(alicePage);
        const tStart = Date.now();
        await alicePage.keyboard.type(chunk, { delay: 15 });

        // Wait for peer sync to complete
        await expect(async () => {
          const val = await getEditorValue(bobPage);
          expect(val).toContain(chunk.trim());
        }).toPass({ timeout: 10000, intervals: [50, 100] });

        const tEnd = Date.now();
        samples.push(tEnd - tStart);
      }

      const stats = calculateLatencyStats(samples);
      printLatencyReport('Remote WAN Keystroke-to-Render (K2R)', stats, targetThreshold);

      // HARD SLA ENFORCEMENT: Strict caps on Median (p50), 95th Percentile (p95), and Maximum (Max)
      expect(stats.median, `HARD SLA VIOLATION: Median latency (${stats.median.toFixed(2)}ms) exceeded hard SLA limit of ${targetThreshold}ms`).toBeLessThanOrEqual(targetThreshold);
      expect(stats.p95, `HARD SLA VIOLATION: 95th percentile latency (${stats.p95.toFixed(2)}ms) exceeded hard SLA limit of ${targetThreshold * 1.5}ms`).toBeLessThanOrEqual(targetThreshold * 1.5);
      expect(stats.max, `HARD SLA VIOLATION: Maximum single edit latency (${stats.max.toFixed(2)}ms) exceeded absolute maximum ceiling of ${targetThreshold * 2}ms`).toBeLessThanOrEqual(targetThreshold * 2);

    } finally {
      await bobContext.close();
    }
  });

  test('2. PTY Terminal High-Frequency Stream Micro-Batching & Backpressure', async ({ page, request }) => {
    const timestamp = Date.now();
    await loginUser(page, request, `PTY_Perf_${timestamp}`);

    await page.fill('input[placeholder="e.g. React-Sandbox"]', `PTY_WS_${timestamp}`);
    await page.click('button:has-text("Create Now")');
    await page.waitForURL(/\/ide\/[0-9a-fA-F-]{36}/);
    await waitForBootComplete(page);

    // Wait for container PTY bash session to finish booting
    const terminalTextarea = page.locator('.xterm-helper-textarea');
    await expect(terminalTextarea).toBeAttached({ timeout: 25000 });
    await waitForTerminalText(page, /sandbox:~#|#|\$/, 30000);
    await page.waitForTimeout(1000);

    // Focus terminal helper textarea
    await terminalTextarea.focus();
    await page.keyboard.type('for i in {1..100}; do echo "HIGH_SPEED_STREAM_LINE_$i"; done', { delay: 5 });
    await page.keyboard.press('Enter');

    // HARD SLA ENFORCEMENT: Stream rendering must complete within 20 seconds max
    await waitForTerminalText(page, 'HIGH_SPEED_STREAM_LINE_100', 20000);
  });

  test('3. Network Throttling & Reconnection Catch-Up Recovery', async ({ page, context, request }) => {
    const alicePage = page;
    const bobContext = await context.browser()!.newContext();
    try {
      const bobPage = await bobContext.newPage();
      const timestamp = Date.now();

      await loginUser(alicePage, request, `Alice_Net_${timestamp}`);
      await loginUser(bobPage, request, `Bob_Net_${timestamp}`);

      await alicePage.fill('input[placeholder="e.g. React-Sandbox"]', `Net_WS_${timestamp}`);
      await alicePage.click('button:has-text("Create Now")');
      await alicePage.waitForURL(/\/ide\/[0-9a-fA-F-]{36}/);
      const workspaceId = extractWorkspaceId(alicePage.url());

      await waitForBootComplete(alicePage);

      // Create test file before inviting Bob for guaranteed file tree sync
      await createFile(alicePage, 'network-recover.js');
      await waitForEditorModel(alicePage, 'network-recover.js');

      await inviteUser(alicePage, `Bob_Net_${timestamp}`, 'editor');

      await bobPage.goto(`${APP_URL}/${workspaceId}`, { waitUntil: 'domcontentloaded' });
      await waitForBootComplete(bobPage);

      const bobFileSelector = bobPage.locator('.ide-scrollbar').getByText('network-recover.js');
      await expect(async () => {
        await expect(bobFileSelector).toBeVisible();
      }).toPass({ timeout: 30000, intervals: [1000] });

      await bobFileSelector.click();
      await waitForEditorModel(bobPage, 'network-recover.js');

      // Simulate high network latency on Bob using CDP
      const cdp = await bobContext.newCDPSession(bobPage);
      await cdp.send('Network.emulateNetworkConditions', {
        offline: false,
        latency: 200, // 200ms synthetic latency
        downloadThroughput: 500 * 1024,
        uploadThroughput: 500 * 1024,
      });

      await focusEditor(alicePage);
      await alicePage.keyboard.type('// Burst under 200ms network throttling\n', { delay: 15 });

      // HARD SLA ENFORCEMENT: Catch-up sync under 200ms latency must complete within 10,000ms max
      await expect(async () => {
        const val = await getEditorValue(bobPage);
        expect(val).toContain('Burst under 200ms network throttling');
      }).toPass({ timeout: 10000, intervals: [200] });

      // Restore normal network
      await cdp.send('Network.emulateNetworkConditions', {
        offline: false,
        latency: 0,
        downloadThroughput: -1,
        uploadThroughput: -1,
      });
    } finally {
      await bobContext.close();
    }
  });
});
