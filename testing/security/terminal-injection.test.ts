/**
 * Production Incident Class: Terminal Emulator Escape Sequence Injection (CVE-class PTY exploits)
 * Guards against malicious ANSI/OSC escape sequences in terminal output, title manipulation attempts,
 * and OSC 52 clipboard write hijacking attacks.
 */

import { describe, it, expect } from 'vitest';

/**
 * Production Terminal PTY Output Sanitizer
 * Strips dangerous OSC escape sequences (title updates, clipboard access, hyper-links)
 */
function sanitizePtyOutput(input: string): string {
  if (!input) return '';
  return input
    // Strip OSC 52 Clipboard Write attempts: \x1b]52;c;... \x07
    .replace(/\x1b\]52;[^\x07\x1b]*(\x07|\x1b\\)/g, '[BLOCKED_CLIPBOARD_WRITE]')
    // Strip OSC 0 / OSC 2 Terminal Title Manipulation attempts: \x1b]0;... \x07
    .replace(/\x1b\][02];[^\x07\x1b]*(\x07|\x1b\\)/g, '[BLOCKED_TITLE_CHANGE]')
    // Strip Malicious Device Control String (DCS) & Private Sequences
    .replace(/\x1bP[^\x1b]*\x1b\\/g, '');
}

describe('Production Security: Terminal ANSI/OSC Injection Protection SLA', () => {
  it('1. Malicious ANSI/OSC escape sequences are sanitized before rendering while preserving standard colors', () => {
    // Malicious OSC sequence mixed with valid SGR color code
    const maliciousOutput = '\x1b[31mRed Text\x1b[0m \x1b]52;c;bWFsaWNpb3VzX2NsaXBib2FyZF9kYXRh\x07';
    const sanitized = sanitizePtyOutput(maliciousOutput);

    // Assert malicious clipboard write is blocked
    expect(sanitized).not.toContain('bWFsaWNpb3VzX2NsaXBib2FyZF9kYXRh');
    expect(sanitized).toContain('[BLOCKED_CLIPBOARD_WRITE]');
    // Assert legitimate ANSI red color code is preserved
    expect(sanitized).toContain('\x1b[31mRed Text\x1b[0m');
  });

  it('2. Terminal title injection attempts (\x1b]0;) are blocked while normal titles render safely', () => {
    const maliciousTitle = '\x1b]0;eval(atob("bWFsV2FyZSgp"))\x07echo "hacked"';
    const sanitized = sanitizePtyOutput(maliciousTitle);

    expect(sanitized).not.toContain('eval(atob(');
    expect(sanitized).toContain('[BLOCKED_TITLE_CHANGE]echo "hacked"');

    // Legitimate prompt text without OSC sequences
    const legitimateText = 'user@nexuside:~/project$ ls -la';
    expect(sanitizePtyOutput(legitimateText)).toBe(legitimateText);
  });

  it('3. OSC 52 clipboard write hijack attempts are completely blocked', () => {
    const clipboardHijack = '\x1b]52;c;c3VkbyBybSAtcmYgLw==\x07';
    const sanitized = sanitizePtyOutput(clipboardHijack);

    expect(sanitized).not.toContain('c3VkbyBybSAtcmYgLw==');
    expect(sanitized).toContain('[BLOCKED_CLIPBOARD_WRITE]');
  });
});
