/**
 * Latency SLA Reporting & Percentile Calculation Utilities
 * Provides statistical analysis (Min, Median, p95, Max, Average) for sub-system SLA verification.
 */

export interface LatencyStats {
  min: number;
  max: number;
  median: number;
  p95: number;
  avg: number;
  samples: number[];
}

/**
 * Calculates statistical distribution metrics from a numeric sample array.
 */
export function calculateLatencyStats(samples: number[]): LatencyStats {
  if (!samples || samples.length === 0) {
    return { min: 0, max: 0, median: 0, p95: 0, avg: 0, samples: [] };
  }

  const sorted = [...samples].sort((a, b) => a - b);
  const min = sorted[0];
  const max = sorted[sorted.length - 1];
  const sum = sorted.reduce((acc, val) => acc + val, 0);
  const avg = sum / sorted.length;

  const getPercentile = (p: number): number => {
    const index = Math.floor(p * sorted.length);
    const clampedIndex = Math.min(Math.max(index, 0), sorted.length - 1);
    return sorted[clampedIndex];
  };

  const median = getPercentile(0.5);
  const p95 = getPercentile(0.95);

  return {
    min,
    max,
    median,
    p95,
    avg,
    samples: sorted,
  };
}

/**
 * Dynamically computes SLA threshold based on local vs CI / Remote Cloud environment flags.
 */
export function getLatencyThreshold(localThreshold: number, ciThreshold: number): number {
  const targetUrl = process.env.NEXUS_BASE_URL || process.env.BASE_URL || '';
  const isRemoteOrCI = !!process.env.CI || (targetUrl !== '' && !targetUrl.includes('localhost') && !targetUrl.includes('127.0.0.1'));
  return isRemoteOrCI ? ciThreshold : localThreshold;
}

/**
 * Prints a clean, structured console summary for tracking latency metrics over time.
 */
export function printLatencyReport(
  subsystemName: string,
  stats: LatencyStats,
  thresholdMs: number
): void {
  const isPassed = stats.p95 <= thresholdMs;
  const envLabel = process.env.CI ? 'CI Environment' : 'Local Environment';

  console.log(`\n============================================================`);
  console.log(` 📊 LATENCY SLA REPORT: ${subsystemName} (${envLabel})`);
  console.log(`============================================================`);
  console.log(`  • Samples Collected: ${stats.samples.length}`);
  console.log(`  • Minimum (Min):    ${stats.min.toFixed(2)}ms`);
  console.log(`  • Median (p50):     ${stats.median.toFixed(2)}ms`);
  console.log(`  • Average (Avg):    ${stats.avg.toFixed(2)}ms`);
  console.log(`  • 95th %ile (p95):  ${stats.p95.toFixed(2)}ms`);
  console.log(`  • Maximum (Max):    ${stats.max.toFixed(2)}ms`);
  console.log(`  • Target Threshold: ${thresholdMs.toFixed(2)}ms`);
  console.log(`  • Status:           ${isPassed ? 'PASSED ✓' : 'FAILED ✗'}`);
  console.log(`============================================================\n`);
}
