import type { Logger } from '../../application/ports/logger.js';
import type { TelemetryEvent } from '../../application/ports/telemetry.js';

export type LogLevel = 'debug' | 'info' | 'warning' | 'error';

const priorities: Readonly<Record<LogLevel, number>> = {
  debug: 10,
  info: 20,
  warning: 30,
  error: 40,
};
const sensitiveKey =
  /api.?key|authorization|cookie|credential|password|proxy|secret|token|environment/i;

export class StructuredLogger implements Logger {
  public constructor(private readonly minimumLevel: LogLevel) {}

  public record(event: TelemetryEvent, data: Readonly<Record<string, unknown>> = {}): void {
    this.write(
      event === 'tool_call_failed' || event === 'provider_failed' || event === 'url_blocked'
        ? 'error'
        : 'info',
      event,
      data,
    );
  }
  public debug(message: string, data: Readonly<Record<string, unknown>> = {}): void {
    this.write('debug', message, data);
  }
  public info(message: string, data: Readonly<Record<string, unknown>> = {}): void {
    this.write('info', message, data);
  }
  public warning(message: string, data: Readonly<Record<string, unknown>> = {}): void {
    this.write('warning', message, data);
  }
  public error(message: string, data: Readonly<Record<string, unknown>> = {}): void {
    this.write('error', message, data);
  }

  private write(level: LogLevel, message: string, data: Readonly<Record<string, unknown>>): void {
    if (priorities[level] < priorities[this.minimumLevel]) return;
    const record = {
      timestamp: new Date().toISOString(),
      level,
      event: message,
      ...sanitizeRecord(data),
    };
    process.stderr.write(`${JSON.stringify(record)}\n`);
  }
}

export function sanitizeLogValue(value: unknown, key = ''): unknown {
  if (sensitiveKey.test(key)) return '[redacted]';
  if (value instanceof Error) return { name: value.name, message: sanitizeString(value.message) };
  if (Array.isArray(value)) return value.map((item) => sanitizeLogValue(item));
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([nestedKey, nestedValue]) => [
        nestedKey,
        sanitizeLogValue(nestedValue, nestedKey),
      ]),
    );
  }
  return typeof value === 'string' ? sanitizeString(value) : value;
}

function sanitizeRecord(
  data: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> {
  return sanitizeLogValue(data) as Readonly<Record<string, unknown>>;
}

const SENSITIVE_VALUE_KEYS = [
  'authorization',
  'credential',
  'password',
  'passwd',
  'secret',
  'token',
  'key',
  'access-token',
  'access_token',
  'accesstoken',
  'refresh-token',
  'refresh_token',
  'refreshtoken',
  'api-key',
  'api_key',
  'apikey',
  'client-secret',
  'client_secret',
  'clientsecret',
  'auth-token',
  'auth_token',
  'authtoken',
  'signature',
  'sig',
] as const;

// One narrow pattern per key (instead of a single large alternation) keeps each regex's
// cognitive complexity low and avoids any risk of catastrophic backtracking.
const SENSITIVE_KEY_VALUE_PATTERNS = SENSITIVE_VALUE_KEYS.map(
  (key) => new RegExp(String.raw`(\b${key}\s*[=:]\s*)([^&\s]+)`, 'giu'),
);
// The two segments cannot both consume ':' or '@', so there is exactly one way to split the
// match: linear time, no backtracking ambiguity.
const URL_USERINFO = /(:\/\/)[^\s/?#@:]+:[^\s/?#@]+@/gu;

function sanitizeString(value: string): string {
  let sanitized = value
    .replace(/Bearer\s+[A-Za-z0-9._~+/-]+=*/giu, 'Bearer [redacted]')
    .replace(URL_USERINFO, '$1[redacted]@');
  for (const pattern of SENSITIVE_KEY_VALUE_PATTERNS) {
    sanitized = sanitized.replace(pattern, '$1[redacted]');
  }
  return sanitized.slice(0, 1_000);
}
