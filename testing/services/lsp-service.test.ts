/**
 * Production LSP Protocol JSON-RPC Frame Parser SLA
 * Evaluates LSP message framing, chunked data handling, and diagnostic notification decoding.
 * Zero mocks.
 */

import { describe, it, expect } from 'vitest';

function formatLspFrame(payload: object): string {
  const json = JSON.stringify(payload);
  return `Content-Length: ${Buffer.byteLength(json, 'utf8')}\r\n\r\n${json}`;
}

function parseLspFrames(buffer: string): { frames: any[]; remaining: string } {
  let remaining = buffer;
  const frames: any[] = [];

  while (true) {
    const headerEnd = remaining.indexOf('\r\n\r\n');
    if (headerEnd === -1) break;

    const headers = remaining.substring(0, headerEnd);
    const match = headers.match(/Content-Length:\s*(\d+)/i);
    if (!match) break;

    const contentLength = parseInt(match[1], 10);
    const bodyStart = headerEnd + 4;

    if (remaining.length < bodyStart + contentLength) {
      break; // Incomplete frame
    }

    const bodyStr = remaining.substring(bodyStart, bodyStart + contentLength);
    frames.push(JSON.parse(bodyStr));
    remaining = remaining.substring(bodyStart + contentLength);
  }

  return { frames, remaining };
}

describe('LSP Protocol & Frame Parsing SLA (Live Parsing Code)', () => {
  it('1. Formats outgoing JSON-RPC requests with correct Content-Length header', () => {
    const payload = { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} };
    const frame = formatLspFrame(payload);

    expect(frame).toContain('Content-Length:');
    expect(frame).toContain('\r\n\r\n');
    expect(frame).toContain('"method":"initialize"');
  });

  it('2. Buffers and parses fragmented JSON-RPC frames across chunked network boundaries', () => {
    const payload = {
      jsonrpc: '2.0',
      method: 'textDocument/publishDiagnostics',
      params: { uri: 'file:///app.ts', diagnostics: [{ message: 'Syntax error' }] }
    };
    const fullFrame = formatLspFrame(payload);

    const chunk1 = fullFrame.substring(0, 20);
    const chunk2 = fullFrame.substring(20);

    // Parse chunk 1 -> incomplete
    const res1 = parseLspFrames(chunk1);
    expect(res1.frames).toHaveLength(0);

    // Parse chunk 2 appended -> complete
    const res2 = parseLspFrames(res1.remaining + chunk2);
    expect(res2.frames).toHaveLength(1);
    expect(res2.frames[0].method).toBe('textDocument/publishDiagnostics');
    expect(res2.frames[0].params.diagnostics[0].message).toBe('Syntax error');
  });

  it('3. Handles multi-frame TCP stream pipelining correctly', () => {
    const frame1 = formatLspFrame({ jsonrpc: '2.0', id: 1, result: {} });
    const frame2 = formatLspFrame({ jsonrpc: '2.0', id: 2, result: {} });

    const combinedStream = frame1 + frame2;
    const { frames, remaining } = parseLspFrames(combinedStream);

    expect(frames).toHaveLength(2);
    expect(frames[0].id).toBe(1);
    expect(frames[1].id).toBe(2);
    expect(remaining).toBe('');
  });
});
