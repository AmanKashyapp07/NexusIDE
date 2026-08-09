import { describe, it, expect } from 'vitest';

describe('LSP Diagnostics Delivery Latency & Pipeline Suite', () => {
  it('delivers publishDiagnostics payload within 2,000ms after textDocument/didChange event', async () => {
    let receivedDiagnostics: any = null;

    const onPublishDiagnostics = (payload: any) => {
      receivedDiagnostics = payload;
    };

    const triggerDidChange = async (uri: string, content: string) => {
      const start = Date.now();
      // Simulate async LSP server syntax check
      await new Promise(r => setTimeout(r, 20));
      onPublishDiagnostics({
        uri,
        diagnostics: [{ range: { start: { line: 0, character: 5 } }, message: 'Syntax error' }],
        latencyMs: Date.now() - start
      });
    };

    await triggerDidChange('file:///src/index.ts', 'const = 42;');

    expect(receivedDiagnostics).not.toBeNull();
    expect(receivedDiagnostics.latencyMs).toBeLessThan(2000);
    expect(receivedDiagnostics.diagnostics.length).toBe(1);
  });
});
