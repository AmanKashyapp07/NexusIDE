/**
 * Purpose: Prometheus Metrics HTTP API Endpoint.
 * Exposes /api/metrics for scraping system metrics, event loop delay, and memory stats.
 */

import { Router } from 'express';
import { metricsService } from '../services/metrics.service.js';

const router = Router();

router.get('/', (_req, res) => {
  res.setHeader('Content-Type', 'text/plain; version=0.0.4');
  res.send(metricsService.getPrometheusMetrics());
});

export default router;
