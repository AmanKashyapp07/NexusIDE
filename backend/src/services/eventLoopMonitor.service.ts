/**
 * Purpose: Backend Node.js Event Loop Lag Telemetry & Performance Monitor.
 * High-Level Architecture: Uses `perf_hooks.monitorEventLoopDelay` to sample backend event loop delays and log warnings when p99 lag exceeds SLAs.
 */

import { monitorEventLoopDelay } from 'perf_hooks';

export class EventLoopMonitorService {
  private histogram = monitorEventLoopDelay({ resolution: 10 });
  private intervalTimer: NodeJS.Timeout | null = null;
  private maxAllowedLagMs: number;

  constructor(maxAllowedLagMs = 20) {
    this.maxAllowedLagMs = maxAllowedLagMs;
  }

  /**
   * Starts monitoring Node.js event loop delay.
   */
  public start(sampleIntervalMs = 5000): void {
    this.histogram.enable();

    this.intervalTimer = setInterval(() => {
      const maxLagMs = this.histogram.max / 1e6;
      const p99LagMs = this.histogram.percentile(99) / 1e6;

      if (maxLagMs > this.maxAllowedLagMs) {
        console.warn(
          `[EventLoop Guard] Backend Event Loop Lag SLA breached! Max: ${maxLagMs.toFixed(
            2
          )}ms, p99: ${p99LagMs.toFixed(2)}ms (Threshold: ${this.maxAllowedLagMs}ms)`
        );
      }

      this.histogram.reset();
    }, sampleIntervalMs);
  }

  /**
   * Stops event loop monitoring.
   */
  public stop(): void {
    if (this.intervalTimer) {
      clearInterval(this.intervalTimer);
      this.intervalTimer = null;
    }
    this.histogram.disable();
  }

  /**
   * Gets current event loop metrics.
   */
  public getMetrics(): { maxMs: number; p99Ms: number; meanMs: number } {
    return {
      maxMs: this.histogram.max / 1e6,
      p99Ms: this.histogram.percentile(99) / 1e6,
      meanMs: this.histogram.mean / 1e6,
    };
  }
}

export const eventLoopMonitorService = new EventLoopMonitorService();
