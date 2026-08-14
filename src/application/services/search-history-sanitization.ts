import type { SearchHistoryRecordInput } from '../ports/search-history-repository.js';

const REDACTED = '[REDACTED]';
const SENSITIVE_KEY =
  /(?:authorization|credential|password|passwd|secret|token|api[-_]?key|signature|sig)/iu;
const KEY_VALUE_SECRET =
  /\b(authorization|credential|password|passwd|secret|access[-_]?token|refresh[-_]?token|api[-_]?key|signature|sig)\s*([:=])\s*("[^"]*"|'[^']*'|[^\s&,;]+)/giu;
const BEARER_TOKEN = /\bBearer\s+[A-Za-z0-9._~+\/-]{8,}=*/giu;
const JWT_TOKEN = /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/gu;
const KNOWN_TOKEN = /\b(?:sk-[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9_]{20,}|AKIA[0-9A-Z]{16})\b/gu;

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
    .replace(BEARER_TOKEN, `Bearer ${REDACTED}`)
    .replace(JWT_TOKEN, REDACTED)
    .replace(KNOWN_TOKEN, REDACTED)
    .replace(
      KEY_VALUE_SECRET,
      (_match, key: string, separator: string) => `${key}${separator}${REDACTED}`,
    );
}

function sanitizeRequest(
  request: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> {
  return Object.fromEntries(
    Object.entries(request).map(([key, value]) => {
      if (SENSITIVE_KEY.test(key)) return [key, REDACTED];
      if (typeof value === 'string') return [key, redactSensitiveSearchText(value)];
      if (Array.isArray(value)) {
        return [
          key,
          value.map((item) =>
            typeof item === 'string' ? redactSensitiveSearchText(item) : item,
          ),
        ];
      }
      return [key, value];
    }),
  );
}
