/**
 * MetricsService Prometheus Scrape Format & Observability Test Suite
 * Evaluates Prometheus text format compliance, counter monotonicity, and V8 event loop metrics.
 * Zero mocks — live Node.js event loop delay histogram and MetricsService.
 */

import { describe, it, expect } from 'vitest';
import { MetricsService } from '../../backend/src/services/metrics.service.js';

describe('MetricsService Prometheus Scrape & Monotonicity SLA', () => {
  it('1. Generates Prometheus exposition format output with parseable # HELP and # TYPE headers', () => {
    const metrics = new MetricsService();

    metrics.setActiveWebSockets(12);
    metrics.setCrdtBufferDepth(45);
    metrics.recordCrdtUpdateProcessed(100);
    metrics.recordDbQueryExecuted(250);

    const output = metrics.getPrometheusMetrics();

    console.log(`[Prometheus Metrics SLA] Generated Output Length: ${output.length} characters`);

    expect(output).toContain('# HELP nexus_active_websockets');
    expect(output).toContain('# TYPE nexus_active_websockets gauge');
    expect(output).toContain('nexus_active_websockets 12');
    expect(output).toContain('nexus_crdt_buffer_depth 45');
    expect(output).toContain('nexus_crdt_updates_processed_total 100');
    expect(output).toContain('nexus_db_queries_executed_total 250');

    metrics.destroy();
  });

  it('2. Asserts counter monotonicity across repeated metric updates', () => {
    const metrics = new MetricsService();

    metrics.recordCrdtUpdateProcessed(10);
    const out1 = metrics.getPrometheusMetrics();
    expect(out1).toContain('nexus_crdt_updates_processed_total 10');

    metrics.recordCrdtUpdateProcessed(15);
    const out2 = metrics.getPrometheusMetrics();
    expect(out2).toContain('nexus_crdt_updates_processed_total 25');

    metrics.destroy();
  });

  it('3. Computes V8 event loop latency metrics safely', () => {
    const metrics = new MetricsService();
    const ev = metrics.getEventLoopMetrics();

    expect(typeof ev.p50).toBe('number');
    expect(typeof ev.p90).toBe('number');
    expect(typeof ev.p99).toBe('number');
    expect(typeof ev.mean).toBe('number');

    metrics.destroy();
  });
});
