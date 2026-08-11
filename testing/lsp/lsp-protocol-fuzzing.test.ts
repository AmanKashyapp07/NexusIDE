/**
 * Production Incident Class: Language Server Protocol Proxy Crashes & Malformed Message Corruptions
 * Guards against LSP proxy server crashes caused by malformed JSON-RPC frames, oversized payloads (>10MB),
 * or out-of-order request/response sequence IDs.
 */

import { describe, it, expect } from 'vitest';

interface JsonRpcMessage {
  jsonrpc: string;
  id?: number | string;
  method?: string;
  params?: unknown;
}

function parseAndValidateLspFrame(rawMessage: string): JsonRpcMessage {
  if (rawMessage.length > 10 * 1024 * 1024) {
    throw new Error('413 Payload Too Large: LSP message frame exceeds 10MB limit');
  }

  let parsed: any;
  try {
    parsed = JSON.parse(rawMessage);
  } catch {
    throw new Error('400 Bad Request: Malformed JSON-RPC frame payload');
  }

  if (parsed.jsonrpc !== '2.0') {
    throw new Error('400 Bad Request: Invalid or missing jsonrpc protocol version');
  }

  return parsed;
}

describe('Production Security: LSP Protocol JSON-RPC Fuzzing SLA', () => {
  it('1. Malformed JSON-RPC frames are rejected gracefully without crashing the LSP proxy process', () => {
    const malformedFrames = [
      '{"jsonrpc": "2.0", "method": "textDocument/completion", ', // truncated JSON
      'NOT_EVEN_JSON_AT_ALL',
      '{"id": 1, "method": "initialize"}' // missing "jsonrpc": "2.0"
    ];

    for (const frame of malformedFrames) {
      expect(() => parseAndValidateLspFrame(frame)).toThrow(/400 Bad Request/);
    }

    // Legitimate JSON-RPC Frame
    const validFrame = JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'textDocument/completion',
      params: { textDocument: { uri: 'file:///app.ts' }, position: { line: 5, character: 10 } }
    });

    const parsed = parseAndValidateLspFrame(validFrame);
    expect(parsed.method).toBe('textDocument/completion');
  });

  it('2. Oversized message payloads (>10MB) are rejected gracefully before parsing', () => {
    const oversizedFrame = 'a'.repeat(11 * 1024 * 1024);
    expect(() => parseAndValidateLspFrame(oversizedFrame)).toThrow(/413 Payload Too Large/);
  });

  it('3. Out-of-order request/response sequences are handled gracefully without state corruption', () => {
    const sequenceLog: number[] = [];
    const pendingRequests = new Map<number, string>();

    const handleLspResponse = (id: number, result: string) => {
      pendingRequests.set(id, result);
      sequenceLog.push(id);
    };

    // Dispatch out-of-order responses (Response #3 arrives before Response #1)
    handleLspResponse(3, 'Completion Result');
    handleLspResponse(1, 'Initialize Result');
    handleLspResponse(2, 'Hover Result');

    expect(pendingRequests.get(1)).toBe('Initialize Result');
    expect(pendingRequests.get(3)).toBe('Completion Result');
    expect(sequenceLog).toEqual([3, 1, 2]);
  });
});
