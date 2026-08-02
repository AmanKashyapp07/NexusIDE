import '@testing-library/jest-dom';
import { vi } from 'vitest';

// Mock ResizeObserver for Monaco Editor
class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}
global.ResizeObserver = ResizeObserverMock;

// Mock matchMedia
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn().mockImplementation(query => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(), // deprecated
    removeListener: vi.fn(), // deprecated
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});

// Mock document.queryCommandSupported
document.queryCommandSupported = vi.fn().mockReturnValue(true);

// Polyfill text encoding/decoding if not present (sometimes jsdom lacks them)
if (typeof global.TextEncoder === 'undefined') {
  const { TextEncoder, TextDecoder } = require('util');
  global.TextEncoder = TextEncoder;
  global.TextDecoder = TextDecoder;
}
// Mock global WebSocket to bypass Node.js/JSDOM Event target prototype mismatch bug
class MockWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;
  readyState = 3;
  send() {}
  close() {}
  addEventListener() {}
  removeEventListener() {}
  dispatchEvent() { return true; }
}
global.WebSocket = MockWebSocket as any;

HTMLCanvasElement.prototype.getContext = () => null;
