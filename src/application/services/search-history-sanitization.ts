import type { SearchHistoryRecordInput } from '../ports/search-history-repository.js';

const REDACTED = '[REDACTED]';
const SENSITIVE_KEY =
  /api.?key|authorization|credential|password|passwd|secret|token|signature|sig/i;

export function sanitizeSearchHistoryRecord(
  record: SearchHistoryRecordInput,
): SearchHistoryRecordInput {
  return {
    ...record,
    query: redactSensitiveSearchText(record.query),
    request: sanitizeRequest(record.request),
  };
}

export function redactSensitiveSearchText(value: string): string {
  return value
    .replace(/Bearer\s+[A-Za-z0-9._~+/-]+=*/giu, `Bearer ${REDACTED}`)
    .replace(/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/gu, REDACTED)
    .replace(
      /\b(?:sk-[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9_]{20,}|AKIA[0-9A-Z]{16})\b/gu,
      REDACTED,
    )
    .replace(
      /(\b(?:authorization|credential|password|passwd|secret|access[-_]?token|refresh[-_]?token|api[-_]?key|signature|sig)\s*[=:]\s*)("[^"]*"|'[^']*'|[^\s&,;]+)/giu,
      `$1${REDACTED}`,
    );
}

function sanitizeRequest(
  request: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> {
  return sanitizeHistoryValue(request) as Readonly<Record<string, unknown>>;
}

function sanitizeHistoryValue(value: unknown, key = ''): unknown {
  if (SENSITIVE_KEY.test(key)) return REDACTED;
  if (Array.isArray(value)) return value.map((item) => sanitizeHistoryValue(item));
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([nestedKey, nestedValue]) => [
        nestedKey,
        sanitizeHistoryValue(nestedValue, nestedKey),
      ]),
    );
  }
  return typeof value === 'string' ? redactSensitiveSearchText(value) : value;
}
