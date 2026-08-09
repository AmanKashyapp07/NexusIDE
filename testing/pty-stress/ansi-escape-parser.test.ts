import { describe, it, expect } from 'vitest';

describe('ANSI Escape Sequence Parser & Sanitization Suite', () => {
  it('sanitizes malicious XTerm OSC title escape sequences to prevent terminal code injection', () => {
    const sanitizeAnsiStream = (rawStdout: string): string => {
      // Strips XTerm OSC 0/1/2 window title setting sequences (\x1b]0;...\x07)
      return rawStdout.replace(/\x1b\][0-2];[^\x07]*\x07/g, '');
    };

    const maliciousOutput = 'Normal Text\x1b]0;malicious_window_title\x07More Output';
    const sanitized = sanitizeAnsiStream(maliciousOutput);

    expect(sanitized).toBe('Normal TextMore Output');
    expect(sanitized).not.toContain('malicious_window_title');
  });
});
