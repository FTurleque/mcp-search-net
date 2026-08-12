import { describe, expect, it } from 'vitest';

import { normalizeCatalogDocumentInput } from '../../src/domain/services/catalog-document-validation.js';
import { validateNewCatalogSource } from '../../src/domain/services/catalog-source-validation.js';
import { normalizeLanguageTag } from '../../src/domain/services/language-tag.js';

describe('catalog language tags', () => {
  it('canonicalizes BCP-47 casing consistently', () => {
    expect(normalizeLanguageTag('en-us')).toBe('en-US');
    expect(normalizeLanguageTag('ZH-hant-tw')).toBe('zh-Hant-TW');
  });

  it('canonicalizes source and document languages before persistence', () => {
    expect(
      validateNewCatalogSource({
        sourceKey: 'docs',
        displayName: 'Docs',
        baseUrl: 'https://example.com/docs',
        sourceType: 'documentation',
        language: 'en-us',
        freshnessPolicy: 'manual',
        syncStrategy: 'manual',
        enabled: true,
      }).language,
    ).toBe('en-US');
    expect(
      normalizeCatalogDocumentInput({
        publicId: 'doc-1',
        sourceId: 1,
        canonicalUrl: 'https://example.com/docs/one',
        stableKey: 'one',
        title: 'One',
        mimeType: 'text/html',
        language: 'en-us',
        status: 'ACTIVE',
      }).language,
    ).toBe('en-US');
  });

  it('rejects invalid language tags', () => {
    expect(() => normalizeLanguageTag('not_a_language_tag')).toThrow('LANGUAGE_TAG_INVALID');
  });
});
