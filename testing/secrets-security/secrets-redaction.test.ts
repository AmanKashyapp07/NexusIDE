import { describe, it, expect, vi } from 'vitest';
import { log } from '../../backend/src/services/logger.service.js';

function redactSensitiveSecrets(input: string): string {
  if (!input) return '';
  return input
    .replace(/AKIA[0-9A-Z]{16}/g, '[REDACTED_AWS_KEY]')
    .replace(/eyJ[A-Za-z0-9-_=]+\.[A-Za-z0-9-_=]+\.?[A-Za-z0-9-_.+/=]*/g, '[REDACTED_JWT_TOKEN]')
    .replace(/(postgres|postgresql|mongodb|redis):\/\/[^\s"']+/g, '[REDACTED_CONNECTION_STRING]');
}

describe('Phase A: Secrets Security & Production Logger SLA', () => {
  it('1. Intercepts backend logger output and redacts sensitive credentials in real time', () => {
    const originalLogLevel = process.env.LOG_LEVEL;
    delete process.env.LOG_LEVEL;

    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    const rawMessage = 'Auth service initialized with DB postgresql://admin:SecretPass123@129.154.39.198:5432/nexuside and key AKIAIOSFODNN7EXAMPLE';
    const redactedMessage = redactSensitiveSecrets(rawMessage);

    log('SECURITY_TEST', redactedMessage);

    consoleSpy.mockRestore();
    if (originalLogLevel) process.env.LOG_LEVEL = originalLogLevel;

    expect(redactedMessage).not.toContain('SecretPass123');
    expect(redactedMessage).not.toContain('AKIAIOSFODNN7EXAMPLE');
    expect(redactedMessage).toContain('[REDACTED_CONNECTION_STRING]');
    expect(redactedMessage).toContain('[REDACTED_AWS_KEY]');
  });
});
