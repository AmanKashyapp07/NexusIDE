import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { LspService } from '../frontend/src/services/LspService';

// Mock backend URLs
vi.mock('../frontend/src/lib/backendUrls', () => ({
  wsUrl: (path: string) => `ws://localhost:3000${path}`,
}));

describe('LspService', () => {
  let originalWebSocket: any;
  let mockWebSocketInstances: any[] = [];

  beforeEach(() => {
    vi.clearAllMocks();
    mockWebSocketInstances = [];
    originalWebSocket = global.WebSocket;

    // Mock WebSocket
    global.WebSocket = class MockWebSocket {
      static CONNECTING = 0;
      static OPEN = 1;
      static CLOSING = 2;
      static CLOSED = 3;

      public readyState = 1; // OPEN
      public url: string;
      public binaryType = 'blob';
      public onmessage: any = null;
      public onopen: any = null;
      public onerror: any = null;
      public onclose: any = null;

      constructor(url: string) {
        this.url = url;
        mockWebSocketInstances.push(this);
        // Automatically trigger open on next tick
        setTimeout(() => {
          if (this.onopen) this.onopen();
        }, 0);
      }
      send = vi.fn();
      close = vi.fn();
    } as any;
  });

  afterEach(() => {
    global.WebSocket = originalWebSocket;
  });

  it('connects and initializes automatically', async () => {
    const service = new LspService('ws1', 'typescript', 'file:///test.ts', 'typescript', 'token123');
    
    let currentStatus = 'off';
    service.onStatusChange((s) => { currentStatus = s; });

    // Connect (promises resolve when initialize completes)
    // For it to complete, we need to send back the response for `initialize`.
    // We capture the send and mock the server response.
    const connectPromise = service.connect();

    // Check connecting state
    expect(currentStatus).toBe('connecting');
    
    // Wait for mock open
    await new Promise(r => setTimeout(r, 10));

    const ws = mockWebSocketInstances[0];
    expect(ws.url).toBe('ws://localhost:3000/ws/lsp/ws1/typescript?token=token123');

    // Find the initialize request id
    const sendCalls = ws.send.mock.calls;
    expect(sendCalls.length).toBeGreaterThan(0);
    const sentData = sendCalls[0][0]; // "Content-Length: X\r\n\r\n{...}"
    const bodyStr = sentData.split('\r\n\r\n')[1];
    const body = JSON.parse(bodyStr);

    expect(body.method).toBe('initialize');
    const reqId = body.id;

    // Simulate server response to `initialize`
    const responsePayload = JSON.stringify({ jsonrpc: '2.0', id: reqId, result: { capabilities: {} } });
    const frame = `Content-Length: ${responsePayload.length}\r\n\r\n${responsePayload}`;
    ws.onmessage({ data: frame });

    await connectPromise;

    expect(currentStatus).toBe('ready');
    expect(service.isInitialized).toBe(true);

    // Verify 'initialized' notification was sent
    const initNotifyCall = ws.send.mock.calls.find((call: any[]) => call[0].includes('"initialized"'));
    expect(initNotifyCall).toBeDefined();
  });

  it('handles request timeouts gracefully', async () => {
    // Fast-forward timers
    vi.useFakeTimers();
    
    const service = new LspService('ws1', 'ts', 'file:///t', 'ts', 'token');
    
    // Just mock ws manually to bypass connect sequence for this isolated test
    (service as any).ws = { readyState: 1, send: vi.fn() };
    
    const reqPromise = service.request('textDocument/hover', { position: { line: 1 } });
    
    // Advance timers past 30 seconds
    vi.advanceTimersByTime(30001);
    
    await expect(reqPromise).rejects.toThrow(/timeout/);
    
    vi.useRealTimers();
  });

  it('buffers and parses fragmented JSON-RPC frames correctly', async () => {
    const service = new LspService('ws1', 'ts', 'file:///t', 'ts', 'token');
    let diagReceived = null;
    service.onDiagnostics((d) => { diagReceived = d; });

    const payload = JSON.stringify({
      jsonrpc: '2.0',
      method: 'textDocument/publishDiagnostics',
      params: { uri: 'file:///t', diagnostics: [{ message: 'Error 1' }] }
    });
    
    const frame = `Content-Length: ${payload.length}\r\n\r\n${payload}`;
    
    // Simulate chunked delivery
    const chunk1 = frame.substring(0, 15);
    const chunk2 = frame.substring(15);
    
    const handleMsg = (service as any).handleMessage.bind(service);
    handleMsg({ data: chunk1 });
    expect(diagReceived).toBeNull(); // Not enough data yet
    
    handleMsg({ data: chunk2 });
    expect(diagReceived).toEqual({ uri: 'file:///t', diagnostics: [{ message: 'Error 1' }] }); // Complete
  });
});
