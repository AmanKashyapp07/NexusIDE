/**
 * Purpose: Continuous Production Observability & Prometheus Metrics Collector.
 * High-Level Architecture: Tracks Node.js event loop latency histogram, V8 heap memory usage,
 * active WebSocket connection count, CRDT write-behind buffer depth, and query execution counters.
 */

import { monitorEventLoopDelay, IntervalHistogram } from 'perf_hooks';

export class MetricsService {
  private histogram: IntervalHistogram | null = null;
  private activeWebSockets = 0;
  private crdtBufferDepth = 0;
  private totalCrdtUpdatesProcessed = 0;
  private totalDbQueriesExecuted = 0;

  constructor() {
    try {
      this.histogram = monitorEventLoopDelay({ resolution: 10 });
      this.histogram.enable();
    } catch {
      // Event loop delay monitoring fallback
    }
  }

  // Socket & Connection Gauges
  setActiveWebSockets(count: number): void {
    this.activeWebSockets = Math.max(0, count);
  }

  incActiveWebSockets(): void {
    this.activeWebSockets++;
  }

  decActiveWebSockets(): void {
    this.activeWebSockets = Math.max(0, this.activeWebSockets - 1);
  }

  // Buffer & Queue Depth Gauges
  setCrdtBufferDepth(depth: number): void {
    this.crdtBufferDepth = Math.max(0, depth);
  }

  // Counters
  recordCrdtUpdateProcessed(count = 1): void {
    this.totalCrdtUpdatesProcessed += count;
  }

  recordDbQueryExecuted(count = 1): void {
    this.totalDbQueriesExecuted += count;
  }

  // Event Loop Delay Metrics (in milliseconds)
  getEventLoopMetrics(): { p50: number; p90: number; p99: number; mean: number } {
    if (!this.histogram) {
      return { p50: 0, p90: 0, p99: 0, mean: 0 };
    }
    const nsToMs = 1e6;
    return {
      p50: Number((this.histogram.percentile(50) / nsToMs).toFixed(2)),
      p90: Number((this.histogram.percentile(90) / nsToMs).toFixed(2)),
      p99: Number((this.histogram.percentile(99) / nsToMs).toFixed(2)),
      mean: Number((this.histogram.mean / nsToMs).toFixed(2)),
    };
  }

  // Prometheus Formatted Output Generator
  getPrometheusMetrics(): string {
    const memory = process.memoryUsage();
    const evLoop = this.getEventLoopMetrics();

    return [
      '# HELP process_cpu_seconds_total Total user and system CPU time spent in seconds.',
      '# TYPE process_cpu_seconds_total counter',
      `process_cpu_seconds_total ${(process.cpuUsage().user / 1e6).toFixed(3)}`,
      '',
      '# HELP process_resident_memory_bytes Resident set size in bytes.',
      '# TYPE process_resident_memory_bytes gauge',
      `process_resident_memory_bytes ${memory.rss}`,
      '',
      '# HELP nodejs_heap_size_total_bytes Process heap size total in bytes.',
      '# TYPE nodejs_heap_size_total_bytes gauge',
      `nodejs_heap_size_total_bytes ${memory.heapTotal}`,
      '',
      '# HELP nodejs_heap_size_used_bytes Process heap size used in bytes.',
      '# TYPE nodejs_heap_size_used_bytes gauge',
      `nodejs_heap_size_used_bytes ${memory.heapUsed}`,
      '',
      '# HELP nexus_event_loop_lag_p50_milliseconds p50 event loop delay in milliseconds.',
      '# TYPE nexus_event_loop_lag_p50_milliseconds gauge',
      `nexus_event_loop_lag_p50_milliseconds ${evLoop.p50}`,
      '',
      '# HELP nexus_event_loop_lag_p99_milliseconds p99 event loop delay in milliseconds.',
      '# TYPE nexus_event_loop_lag_p99_milliseconds gauge',
      `nexus_event_loop_lag_p99_milliseconds ${evLoop.p99}`,
      '',
      '# HELP nexus_active_websockets Current active WebSocket connection count.',
      '# TYPE nexus_active_websockets gauge',
      `nexus_active_websockets ${this.activeWebSockets}`,
      '',
      '# HELP nexus_crdt_buffer_depth Current Redis/RAM CRDT write-behind buffer depth.',
      '# TYPE nexus_crdt_buffer_depth gauge',
      `nexus_crdt_buffer_depth ${this.crdtBufferDepth}`,
      '',
      '# HELP nexus_crdt_updates_processed_total Total CRDT binary updates processed.',
      '# TYPE nexus_crdt_updates_processed_total counter',
      `nexus_crdt_updates_processed_total ${this.totalCrdtUpdatesProcessed}`,
      '',
      '# HELP nexus_db_queries_executed_total Total database queries executed.',
      '# TYPE nexus_db_queries_executed_total counter',
      `nexus_db_queries_executed_total ${this.totalDbQueriesExecuted}`,
      '',
    ].join('\n');
  }

  destroy(): void {
    if (this.histogram) {
      try { this.histogram.disable(); } catch {}
      this.histogram = null;
    }
  }
}

export const metricsService = new MetricsService();
