/**
 * Vitest Worker Setup — runs inside each test worker process before any test file.
 *
 * This is the correct place to set process.setMaxListeners() because the warning
 * fires in the worker, not in the main Vitest orchestration process.
 *
 * Background:
 *   Each backend test suite calls server.listen() which registers SIGINT/SIGTERM
 *   handlers on `process`. With 10+ test suites in a single worker the default
 *   limit of 10 is exceeded, generating MaxListenersExceededWarning noise.
 */
import { EventEmitter } from 'events';

// Bump limit BEFORE any backend module is imported (vi.mock() hoisting ensures
// this file runs before the test body, but after the import map is set up).
EventEmitter.defaultMaxListeners = 100;
process.setMaxListeners(100);
