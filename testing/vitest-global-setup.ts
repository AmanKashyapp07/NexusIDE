/**
 * Vitest Global Setup — runs once before the test worker pool starts.
 *
 * Purpose:
 *  - Bump Node.js process max listener limit so that the many HTTP server
 *    instances created across the backend test suites do not trigger
 *    MaxListenersExceededWarning for SIGINT/SIGTERM handlers.
 *  - Set CI-appropriate environment variables.
 */
import { EventEmitter } from 'events';

export function setup() {
  EventEmitter.defaultMaxListeners = 100;
  process.setMaxListeners(100);

  process.env.NODE_ENV = process.env.NODE_ENV ?? 'test';
  process.env.LOG_LEVEL = process.env.LOG_LEVEL ?? 'silent';
}

export function teardown() {
}
