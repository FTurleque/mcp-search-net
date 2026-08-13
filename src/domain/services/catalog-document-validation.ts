import type { CatalogDocumentInput, DocumentStatus } from '../models/catalog.js';
import {
  countUnicodeCharacters,
  MAX_CATALOG_MIME_TYPE_CHARACTERS,
  MAX_CATALOG_STABLE_KEY_CHARACTERS,
  MAX_CATALOG_URL_CHARACTERS,
  MAX_EXTERNAL_DOCUMENT_PUBLIC_ID_CHARACTERS,
  MAX_EXTERNAL_TITLE_CHARACTERS,
  truncateUnicode,
} from './bounded-text.js';
import { normalizeLanguageTag } from './language-tag.js';
import { containsControlCharacters } from './text-validation.js';

const DOCUMENT_STATUSES = new Set<DocumentStatus>([
  'ACTIVE',
  'STALE',
  'REDIRECTED',
  'REMOVED',
  'UNAVAILABLE',
]);

export function normalizeCatalogDocumentInput(input: CatalogDocumentInput): CatalogDocumentInput {
  if (!Number.isSafeInteger(input.sourceId) || input.sourceId <= 0) {
    throw new Error('CATALOG_DOCUMENT_SOURCE_ID_INVALID');
  }

  const publicId = boundedRequiredText(
    input.publicId,
    MAX_EXTERNAL_DOCUMENT_PUBLIC_ID_CHARACTERS,
    'CATALOG_DOCUMENT_PUBLIC_ID_INVALID',
  );
  const stableKey = boundedRequiredText(
    input.stableKey,
    MAX_CATALOG_STABLE_KEY_CHARACTERS,
    'CATALOG_DOCUMENT_STABLE_KEY_INVALID',
  );
  const mimeType = boundedRequiredText(
    input.mimeType,
    MAX_CATALOG_MIME_TYPE_CHARACTERS,
    'CATALOG_DOCUMENT_MIME_TYPE_INVALID',
  );
  const language = normalizeLanguageTag(input.language, 'CATALOG_DOCUMENT_LANGUAGE_INVALID');

  const title = input.title.trim();
  if (title === '' || containsControlCharacters(title)) {
    throw new Error('CATALOG_DOCUMENT_TITLE_INVALID');
  }
  const boundedTitle = truncateUnicode(title, MAX_EXTERNAL_TITLE_CHARACTERS);

  const canonicalUrl = normalizeHttpUrl(input.canonicalUrl);
  if (!DOCUMENT_STATUSES.has(input.status)) throw new Error('CATALOG_DOCUMENT_STATUS_INVALID');

  return {
    ...input,
    publicId,
    canonicalUrl,
    stableKey,
    title: boundedTitle,
    mimeType,
    language,
  };
}

function boundedRequiredText(value: string, maximum: number, code: string): string {
  const normalized = value.trim();
  if (
    normalized === '' ||
    containsControlCharacters(normalized) ||
    countUnicodeCharacters(normalized) > maximum
  ) {
    throw new Error(code);
  }
  return normalized;
}

function normalizeHttpUrl(value: string): string {
  const normalized = value.trim();
  if (
    normalized === '' ||
    containsControlCharacters(normalized) ||
    countUnicodeCharacters(normalized) > MAX_CATALOG_URL_CHARACTERS
  ) {
    throw new Error('CATALOG_DOCUMENT_URL_INVALID');
  }

  let url: URL;
  try {
    url = new URL(normalized);
  } catch {
    throw new Error('CATALOG_DOCUMENT_URL_INVALID');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('CATALOG_DOCUMENT_URL_INVALID');
  }
  if (url.username !== '' || url.password !== '') {
    throw new Error('CATALOG_DOCUMENT_URL_INVALID');
  }
  return url.toString();
}
