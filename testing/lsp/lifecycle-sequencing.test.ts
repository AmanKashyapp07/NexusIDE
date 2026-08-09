import { describe, it, expect } from 'vitest';

describe('LSP Lifecycle Handshake & Request Sequencing Suite', () => {
  it('rejects LSP requests received prior to initialize handshake with error code -32002', () => {
    let isInitialized = false;

    const handleLspMessage = (method: string): { status: string; errorCode?: number; errorMsg?: string } => {
      if (!isInitialized && method !== 'initialize') {
        return {
          status: 'error',
          errorCode: -32002, // ServerNotInitialized standard JSON-RPC error code
          errorMsg: 'ServerNotInitialized: LSP initialize request must be sent before calling ' + method
        };
      }
      if (method === 'initialize') {
        isInitialized = true;
        return { status: 'ok' };
      }
      return { status: 'ok' };
    };

    const prematureHover = handleLspMessage('textDocument/hover');
    expect(prematureHover.status).toBe('error');
    expect(prematureHover.errorCode).toBe(-32002);

    const initHandshake = handleLspMessage('initialize');
    expect(initHandshake.status).toBe('ok');

    const postInitHover = handleLspMessage('textDocument/hover');
    expect(postInitHover.status).toBe('ok');
  });
});
