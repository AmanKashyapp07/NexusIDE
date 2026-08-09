import { describe, it, expect, afterAll } from 'vitest';
import { MetricsService } from '../../backend/src/services/metrics.service.js';

describe('Phase 5: Distributed Scaling & Continuous Observability Suite', () => {
  const metrics = new MetricsService();

  afterAll(() => {
    metrics.destroy();
  });

  // ===========================================================================
  // 1. METRICS COUNTERS AND GAUGES
  // ===========================================================================

  it('Increments, decrements, and sets active WebSocket connection gauges correctly', () => {
    metrics.setActiveWebSockets(0);
    metrics.incActiveWebSockets();
    metrics.incActiveWebSockets();
    expect((metrics as any).activeWebSockets).toBe(2);

    metrics.decActiveWebSockets();
    expect((metrics as any).activeWebSockets).toBe(1);

    metrics.setActiveWebSockets(42);
    expect((metrics as any).activeWebSockets).toBe(42);
  });

  it('Tracks CRDT buffer depth and updates/queries executed counters', () => {
    metrics.setCrdtBufferDepth(120);
    expect((metrics as any).crdtBufferDepth).toBe(120);

    const initialUpdates = (metrics as any).totalCrdtUpdatesProcessed;
    metrics.recordCrdtUpdateProcessed(15);
    expect((metrics as any).totalCrdtUpdatesProcessed).toBe(initialUpdates + 15);

    const initialQueries = (metrics as any).totalDbQueriesExecuted;
    metrics.recordDbQueryExecuted(5);
    expect((metrics as any).totalDbQueriesExecuted).toBe(initialQueries + 5);
  });

  // ===========================================================================
  // 2. EVENT LOOP DELAY MONITORING
  // ===========================================================================

  it('Provides event loop latency histogram percentiles (p50, p90, p99)', () => {
    const evMetrics = metrics.getEventLoopMetrics();
    expect(evMetrics).toBeDefined();
    expect(typeof evMetrics.p50).toBe('number');
    expect(typeof evMetrics.p90).toBe('number');
    expect(typeof evMetrics.p99).toBe('number');
    expect(typeof evMetrics.mean).toBe('number');
  });

  // ===========================================================================
  // 3. PROMETHEUS METRICS FORMATTING
  // ===========================================================================

  it('Generates valid Prometheus text-formatted metrics output', () => {
    metrics.setActiveWebSockets(10);
    metrics.setCrdtBufferDepth(25);

    const output = metrics.getPrometheusMetrics();

    expect(output).toContain('process_resident_memory_bytes');
    expect(output).toContain('nodejs_heap_size_used_bytes');
    expect(output).toContain('nexus_event_loop_lag_p50_milliseconds');
    expect(output).toContain('nexus_event_loop_lag_p99_milliseconds');
    expect(output).toContain('nexus_active_websockets 10');
    expect(output).toContain('nexus_crdt_buffer_depth 25');
    expect(output).toContain('nexus_crdt_updates_processed_total');
    expect(output).toContain('nexus_db_queries_executed_total');
  });
});
