import { test, expect } from '@playwright/test';
import {
  APP_URL, loginUser, waitForBootComplete, focusEditor,
  createFile, getEditorValue, waitForEditorModel
} from '../test-utils';

test.describe('E2E Deployed Infrastructure - Monaco Editor V8 Heap & Memory Leak SLA', () => {
  test.describe.configure({ mode: 'serial' });

  test('1. Sustained Editing & Multi-Tab V8 Heap Memory Leak Benchmark', async ({ page, context, request }) => {
    const timestamp = Date.now();
    await loginUser(page, request, `Mem_Leak_User_${timestamp}`);

    await page.fill('input[placeholder="e.g. React-Sandbox"]', `Mem_WS_${timestamp}`);
    await page.click('button:has-text("Create Now")');
    await page.waitForURL(/\/ide\/[0-9a-fA-F-]{36}/);
    await waitForBootComplete(page);

    // Initialize CDP session for V8 heap profiling
    const cdp = await context.newCDPSession(page);
    await cdp.send('Performance.enable');

    // Helper to get JS Heap Used Size in MB after forcing V8 Garbage Collection
    const getPostGcHeapMb = async (): Promise<number> => {
      await cdp.send('HeapProfiler.collectGarbage');
      await page.waitForTimeout(300);
      const metrics = await cdp.send('Performance.getMetrics');
      const heapMetric = metrics.metrics.find(m => m.name === 'JSHeapUsedSize');
      return heapMetric ? heapMetric.value / (1024 * 1024) : 0;
    };

    // Force initial GC and record baseline heap
    const baselineHeapMb = await getPostGcHeapMb();
    console.log(`[Memory SLA] Initial Baseline Post-GC V8 Heap: ${baselineHeapMb.toFixed(2)} MB`);

    // Create 10 files to simulate multi-tab switching and model allocations
    for (let f = 1; f <= 10; f++) {
      const fileName = `heap-file-${f}.js`;
      await createFile(page, fileName);
      await waitForEditorModel(page, fileName);

      const fileSelector = page.locator('.ide-scrollbar').getByText(fileName).first();
      await expect(fileSelector).toBeVisible({ timeout: 10000 });
      await fileSelector.click();
      await waitForEditorModel(page, fileName);

      await focusEditor(page);
      await page.keyboard.type(`// File ${f} sustained memory load iteration\nconst data = ${f} * 100;\n`, { delay: 5 });
    }

    // Perform intensive tab switching to exercise Monaco model disposers & UI listeners
    for (let loop = 1; loop <= 5; loop++) {
      for (let f = 1; f <= 10; f++) {
        const fileSelector = page.locator('.ide-scrollbar').getByText(`heap-file-${f}.js`).first();
        await fileSelector.click();
        await page.waitForTimeout(50);
      }
    }

    // Force V8 GC and calculate heap retention delta
    const finalHeapMb = await getPostGcHeapMb();
    const heapGrowthMb = finalHeapMb - baselineHeapMb;

    console.log(`[Memory SLA] Final Post-GC V8 Heap: ${finalHeapMb.toFixed(2)} MB`);
    console.log(`[Memory SLA] V8 Heap Growth Delta: ${heapGrowthMb.toFixed(2)} MB`);

    // HARD SLA ENFORCEMENT: 10 active Monaco models + 50 tab switches must retain < 15.0 MB working V8 memory
    expect(
      heapGrowthMb,
      `HARD MEMORY SLA VIOLATION: Post-GC V8 Heap growth (${heapGrowthMb.toFixed(2)} MB) exceeded 15.0 MB retention ceiling`
    ).toBeLessThanOrEqual(15.0);
  });
});
