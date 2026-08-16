import { describe, expect, it } from 'vitest';

import type { CatalogDocumentInput } from '../../src/domain/models/catalog.js';
import { normalizeCatalogDocumentInput } from '../../src/domain/services/catalog-document-validation.js';

const VALID_INPUT: CatalogDocumentInput = {
  publicId: 'docs:guide',
  sourceId: 1,
  canonicalUrl: 'https://docs.example/guide',
  stableKey: 'guide',
  title: 'Guide',
  mimeType: 'text/html',
  language: 'en-US',
  status: 'ACTIVE',
};

describe('catalog document input validation', () => {
  it.each([0, 1.5])('rejects invalid source ids before persistence (%s)', (sourceId) => {
    expect(() => normalizeCatalogDocumentInput({ ...VALID_INPUT, sourceId })).toThrow(
      'CATALOG_DOCUMENT_SOURCE_ID_INVALID',
    );
  });

  it.each([
    ['', 'CATALOG_DOCUMENT_PUBLIC_ID_INVALID'],
    ['bad\u0001id', 'CATALOG_DOCUMENT_PUBLIC_ID_INVALID'],
    ['x'.repeat(129), 'CATALOG_DOCUMENT_PUBLIC_ID_INVALID'],
  ])('rejects invalid public ids before persistence', (publicId, errorCode) => {
    expect(() => normalizeCatalogDocumentInput({ ...VALID_INPUT, publicId })).toThrow(errorCode);
  });

  it('rejects an unsupported durable document status', () => {
    expect(() =>
      normalizeCatalogDocumentInput({
        ...VALID_INPUT,
        status: 'UNKNOWN' as CatalogDocumentInput['status'],
      }),
    ).toThrow('CATALOG_DOCUMENT_STATUS_INVALID');
  });

  it('keeps a valid normalized document input', () => {
    expect(normalizeCatalogDocumentInput(VALID_INPUT)).toMatchObject(VALID_INPUT);
  });
});
