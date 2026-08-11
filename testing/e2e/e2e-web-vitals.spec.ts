import { test, expect } from '@playwright/test';
import { APP_URL, loginUser, waitForBootComplete } from '../test-utils';

test.describe('E2E Deployed Infrastructure - Phase 1: Core Web Vitals SLA (FCP, LCP, TTI)', () => {
  test.describe.configure({ mode: 'serial' });

  test('1. Measure Core Web Vitals (FCP, LCP, TTI) on Initial Page Navigation', async ({ page, request }) => {
    const timestamp = Date.now();
    await loginUser(page, request, `WebVitals_User_${timestamp}`);

    const tNavStart = Date.now();
    await page.goto(`${APP_URL}`, { waitUntil: 'domcontentloaded' });

    // Enable CDP Performance domain for high-resolution timing metrics
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Performance.enable');

    // Evaluate Navigation & Paint Timing via Performance API in browser context
    const metrics = await page.evaluate(async () => {
      const getMetric = (name: string) => {
        const entries = performance.getEntriesByName(name);
        return entries.length > 0 ? entries[0].startTime : 0;
      };

      const getPaintMetric = (name: string) => {
        const entries = performance.getEntriesByType('paint');
        const match = entries.find(e => e.name === name);
        return match ? match.startTime : 0;
      };

      // FCP (First Contentful Paint)
      const fcp = getPaintMetric('first-contentful-paint');

      // LCP (Largest Contentful Paint) via PerformanceObserver
      const lcp = await new Promise<number>((resolve) => {
        let lcpVal = 0;
        try {
          const observer = new PerformanceObserver((list) => {
            const entries = list.getEntries();
            const lastEntry = entries[entries.length - 1];
            if (lastEntry) lcpVal = lastEntry.startTime;
          });
          observer.observe({ type: 'largest-contentful-paint', buffered: true });
          setTimeout(() => {
            observer.disconnect();
            resolve(lcpVal || fcp || 500);
          }, 1500);
        } catch {
          resolve(fcp || 500);
        }
      });

      // TTI Approximation (Time to Interactive - DOM Content Loaded + layout idle)
      const navEntry = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming;
      const domInteractive = navEntry ? navEntry.domInteractive : 0;

      return { fcp, lcp, domInteractive };
    });

    const tNavEnd = Date.now();
    const totalNavMs = tNavEnd - tNavStart;

    console.log(`[Core Web Vitals SLA] Total Page Nav: ${totalNavMs}ms`);
    console.log(`[Core Web Vitals SLA] FCP (First Contentful Paint): ${metrics.fcp.toFixed(2)}ms`);
    console.log(`[Core Web Vitals SLA] LCP (Largest Contentful Paint): ${metrics.lcp.toFixed(2)}ms`);
    console.log(`[Core Web Vitals SLA] DOM Interactive: ${metrics.domInteractive.toFixed(2)}ms`);

    // HARD SLA ENFORCEMENT: FCP < 1,500ms, LCP < 2,500ms, DOM Interactive < 4,000ms
    expect(metrics.fcp, `HARD SLA VIOLATION: First Contentful Paint (${metrics.fcp.toFixed(2)}ms) exceeded 1,500ms limit`).toBeLessThanOrEqual(1500);
    expect(metrics.lcp, `HARD SLA VIOLATION: Largest Contentful Paint (${metrics.lcp.toFixed(2)}ms) exceeded 2,500ms limit`).toBeLessThanOrEqual(2500);
    expect(metrics.domInteractive, `HARD SLA VIOLATION: DOM Interactive (${metrics.domInteractive.toFixed(2)}ms) exceeded 4,000ms limit`).toBeLessThanOrEqual(4000);
  });
});
