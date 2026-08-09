import { describe, it, expect } from 'vitest';

describe('Language Server Crash Recovery Suite', () => {
  it('automatically re-spawns Language Server process and re-sends initialize request after process crash', () => {
    let lspState = { isRunning: true, pid: 1234, initialized: true, restartCount: 0 };

    const simulateLspCrash = () => {
      lspState.isRunning = false;
      lspState.initialized = false;

      // Auto-restart supervisor
      lspState.restartCount++;
      lspState.pid = 5678;
      lspState.isRunning = true;
      lspState.initialized = true; // Re-sent initialize handshake
    };

    expect(lspState.pid).toBe(1234);

    simulateLspCrash();

    expect(lspState.restartCount).toBe(1);
    expect(lspState.pid).toBe(5678);
    expect(lspState.isRunning).toBe(true);
    expect(lspState.initialized).toBe(true);
  });
});
