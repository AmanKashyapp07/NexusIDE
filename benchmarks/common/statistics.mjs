import { performance } from 'perf_hooks';

export class Statistics {
  /**
   * Compute statistical summary for a series of numbers (latencies in ms)
   * @param {number[]} samples
   */
  static summarize(samples) {
    if (!samples || samples.length === 0) {
      return { n: 0, min: 0, max: 0, mean: 0, median: 0, p95: 0, p99: 0, stddev: 0 };
    }

    const sorted = [...samples].sort((a, b) => a - b);
    const n = sorted.length;
    const min = sorted[0];
    const max = sorted[n - 1];
    const sum = sorted.reduce((acc, v) => acc + v, 0);
    const mean = sum / n;

    const median = n % 2 === 1
      ? sorted[Math.floor(n / 2)]
      : (sorted[n / 2 - 1] + sorted[n / 2]) / 2;

    const p95Index = Math.min(n - 1, Math.floor(n * 0.95));
    const p99Index = Math.min(n - 1, Math.floor(n * 0.99));
    const p95 = sorted[p95Index];
    const p99 = sorted[p99Index];

    const variance = sorted.reduce((acc, v) => acc + Math.pow(v - mean, 2), 0) / n;
    const stddev = Math.sqrt(variance);

    // With discrete floor-index percentile estimator floor(n * p), p95 selects max when n <= 20, p99 when n <= 100
    const isP95AtMax = p95Index >= n - 1;
    const isP99AtMax = p99Index >= n - 1;

    return {
      n,
      min: Number(min.toFixed(6)),
      max: Number(max.toFixed(6)),
      mean: Number(mean.toFixed(6)),
      median: Number(median.toFixed(6)),
      p95: Number(p95.toFixed(6)),
      p99: Number(p99.toFixed(6)),
      p95SampleWarning: isP95AtMax
        ? `Sample size n=${n} insufficient for distinct p95 (floor(n*0.95)=${p95Index} selects max observation; requires n>=21)`
        : undefined,
      p99SampleWarning: isP99AtMax
        ? `Sample size n=${n} insufficient for distinct p99 (floor(n*0.99)=${p99Index} selects max observation; requires n>=101)`
        : undefined,
      stddev: Number(stddev.toFixed(6)),
      opsPerSec: median > 0 ? Math.round(1000 / median) : Math.round(1000 / (mean || 0.000001))
    };
  }

  /**
   * Measure function execution with warmup
   * @param {() => Promise<void> | void} fn
   * @param {number} iterations
   * @param {number} warmup
   */
  static async measureAsync(fn, iterations = 1000, warmup = 100) {
    for (let i = 0; i < warmup; i++) {
      await fn();
    }

    const samples = new Array(iterations);
    for (let i = 0; i < iterations; i++) {
      const t0 = performance.now();
      await fn();
      const t1 = performance.now();
      samples[i] = t1 - t0;
    }

    return this.summarize(samples);
  }

  /**
   * Synchronous measure function execution with warmup
   * @param {() => void} fn
   * @param {number} iterations
   * @param {number} warmup
   */
  static measureSync(fn, iterations = 1000, warmup = 100) {
    for (let i = 0; i < warmup; i++) {
      fn();
    }

    const samples = new Array(iterations);
    for (let i = 0; i < iterations; i++) {
      const t0 = performance.now();
      fn();
      const t1 = performance.now();
      samples[i] = t1 - t0;
    }

    return this.summarize(samples);
  }

  /**
   * Measure batch execution when per-op latency is sub-microsecond
   * @param {() => void} fn
   * @param {number} batchSize
   * @param {number} batchCount
   * @param {number} warmupBatches
   */
  static measureSyncBatched(fn, batchSize = 1000, batchCount = 100, warmupBatches = 10) {
    for (let w = 0; w < warmupBatches; w++) {
      for (let i = 0; i < batchSize; i++) {
        fn();
      }
    }

    const perOpSamples = new Array(batchCount);
    for (let b = 0; b < batchCount; b++) {
      const t0 = performance.now();
      for (let i = 0; i < batchSize; i++) {
        fn();
      }
      const t1 = performance.now();
      perOpSamples[b] = (t1 - t0) / batchSize;
    }

    return this.summarize(perOpSamples);
  }
}
