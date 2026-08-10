/**
 * Purpose: Client-Side Real User Monitoring (RUM), Latency Instrumentation & INP Telemetry.
 * High-Level Architecture: Tracks interactive input-to-echo roundtrips via `performance.mark` & `performance.measure`, while observing browser long tasks (> 50ms).
 */

class LatencyTelemetryService {
  private observer: PerformanceObserver | null = null;
  private markCounter = 0;

  /**
   * Initializes browser PerformanceObserver for long tasks (> 50ms) and INP tracking.
   */
  public initPerformanceObserver(): void {
    if (typeof window === 'undefined' || !('PerformanceObserver' in window)) return;

    try {
      this.observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          if (entry.duration > 50) {
            console.warn(
              `[Latency Telemetry] Long Task Detected: ${entry.name} took ${entry.duration.toFixed(1)}ms`
            );
          }
        }
      });

      this.observer.observe({ type: 'longtask', buffered: true });
    } catch {
      // PerformanceObserver unsupported or restricted in browser context
    }
  }

  /**
   * Creates a unique performance mark when a user presses an interactive key.
   */
  public markInput(tag = 'terminal'): string {
    if (typeof performance === 'undefined') return '';
    const markName = `input-${tag}-${++this.markCounter}-${Date.now()}`;
    try {
      performance.mark(markName);
    } catch {}
    return markName;
  }

  /**
   * Measures roundtrip elapsed time when server echo arrives for a given mark.
   */
  public measureEcho(markName: string, thresholdMs = 30): number | null {
    if (!markName || typeof performance === 'undefined') return null;

    try {
      const measureName = `measure-${markName}`;
      const measure = performance.measure(measureName, markName);
      const duration = measure.duration;

      // Clean up performance entries from memory
      performance.clearMarks(markName);
      performance.clearMeasures(measureName);

      if (duration > thresholdMs) {
        console.warn(
          `[Latency Telemetry Guard] Echo SLA breached: ${duration.toFixed(2)}ms (Threshold: ${thresholdMs}ms)`
        );
      }

      return duration;
    } catch {
      return null;
    }
  }
}

export const latencyTelemetry = new LatencyTelemetryService();
