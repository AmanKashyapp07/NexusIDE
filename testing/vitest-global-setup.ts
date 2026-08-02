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
  // Each backend test suite that calls server.listen() registers SIGINT/SIGTERM
  // handlers on the global `process`. With 10+ test suites the default limit
  // of 10 is easily exceeded.  Bump both the generic EventEmitter default AND
  // the process object itself.
  EventEmitter.defaultMaxListeners = 100;
  process.setMaxListeners(100);

  // Ensure tests never accidentally hit a real database or Redis
  process.env.NODE_ENV = process.env.NODE_ENV ?? 'test';
  process.env.LOG_LEVEL = process.env.LOG_LEVEL ?? 'silent';
}

export function teardown() {
  // Nothing to tear down at the global level — individual test suites manage
  // their own server lifecycle via beforeEach / afterEach.
}
