import { describe, expect, it } from 'vitest';

import { sanitizeLogValue } from '../../src/infrastructure/logging/structured-logger.js';

describe('structured logger sanitization', () => {
  it.each([
    'https://host/api?api_key=SECRET123',
    'https://host/api?apikey=SECRET123',
    'https://host/api?api-key=SECRET123',
    'https://host/api?access_token=SECRET123',
    'https://host/api?accessToken=SECRET123',
    'https://host/api?refresh_token=SECRET123',
    'https://host/api?client_secret=SECRET123',
    'https://host/api?auth_token=SECRET123',
    'token=SECRET123',
    'key=SECRET123',
    'secret=SECRET123',
    'password=SECRET123',
    'Authorization: SECRET123',
  ])('redacts sensitive query/keyword values in %s', (input) => {
    expect(sanitizeLogValue(input)).not.toContain('SECRET123');
  });

  it('redacts Bearer tokens', () => {
    expect(sanitizeLogValue('Bearer abc.def-123')).toBe('Bearer [redacted]');
  });

  it('redacts userinfo credentials embedded in a URL', () => {
    const sanitized = sanitizeLogValue('https://alice:hunter2@host/path') as string;
    expect(sanitized).not.toContain('hunter2');
    expect(sanitized).not.toContain('alice');
    expect(sanitized).toContain('https://[redacted]@host/path');
  });

  it.each([
    ['https://single-userinfo-secret@example.com/', 'single-userinfo-secret'],
    ['https://user:password@example.com/', 'password'],
    ['http://token@localhost:8888/path', 'token'],
    ['http://user:password@localhost:8888/', 'password'],
  ])('redacts URL userinfo in %s without leaking the secret', (input, secret) => {
    const sanitized = sanitizeLogValue(input) as string;
    expect(sanitized).not.toContain(secret);
    expect(sanitized).not.toContain('user:password');
  });

  it('preserves the scheme, host and path when redacting URL userinfo', () => {
    expect(sanitizeLogValue('https://single-userinfo-secret@example.com/')).toBe(
      'https://[redacted]@example.com/',
    );
    expect(sanitizeLogValue('http://token@localhost:8888/path')).toBe(
      'http://[redacted]@localhost:8888/path',
    );
  });

  it.each([
    'https://example.com/@handle',
    'contact us at user@example.com',
    'see docs at https://example.com/docs#section@1',
  ])('does not redact a bare "@" that is not URL userinfo in %s', (input) => {
    expect(sanitizeLogValue(input)).toBe(input);
  });

  it('redacts by key name regardless of nesting or case/separator variant', () => {
    const sanitized = sanitizeLogValue({
      Authorization: 'Bearer xxx',
      nested: { api_key: 'SECRET', other: 'kept' },
    }) as Record<string, unknown>;
    expect(sanitized['Authorization']).toBe('[redacted]');
    expect((sanitized['nested'] as Record<string, unknown>)['api_key']).toBe('[redacted]');
    expect((sanitized['nested'] as Record<string, unknown>)['other']).toBe('kept');
  });

  it('never logs an Error stack trace or raw message beyond sanitization', () => {
    const error = new Error('token=SECRET123');
    const sanitized = sanitizeLogValue(error) as { name: string; message: string };
    expect(sanitized).not.toHaveProperty('stack');
    expect(sanitized.message).not.toContain('SECRET123');
  });

  it('leaves non-sensitive strings untouched', () => {
    expect(sanitizeLogValue('plain diagnostic text')).toBe('plain diagnostic text');
  });
});
