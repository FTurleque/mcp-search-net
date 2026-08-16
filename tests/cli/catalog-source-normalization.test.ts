import { describe, expect, it } from 'vitest';

import { parseCatalogSourceConfig } from '../../src/cli/catalog-source-config.js';

describe('catalog source canonicalization and document preflight', () => {
  it('uses the canonical source key and canonical inherited language for documents', () => {
    const parsed = parseCatalogSourceConfig(`
schema_version: 1
sources:
  " docs ":
    display_name: Docs
    base_url: https://docs.example/
    language: EN-us
    documents:
      - stable_key: " guide "
        title: " Guide "
        url: https://docs.example/guide
`);

    expect(parsed.sources).toMatchObject([{ sourceKey: 'docs', language: 'en-US' }]);
    expect(parsed.documents).toMatchObject([
      {
        sourceKey: 'docs',
        stableKey: 'guide',
        title: 'Guide',
        language: 'en-US',
        url: 'https://docs.example/guide',
      },
    ]);
  });

  it('rejects source declarations that collide after canonicalization', () => {
    expect(() =>
      parseCatalogSourceConfig(`
schema_version: 1
sources:
  docs:
    display_name: Docs A
    base_url: https://a.example/
  " docs ":
    display_name: Docs B
    base_url: https://b.example/
`),
    ).toThrow('catalog source config contains duplicate canonical source key docs');
  });

  it('rejects stable keys that collide after document canonicalization', () => {
    expect(() =>
      parseCatalogSourceConfig(`
schema_version: 1
sources:
  docs:
    display_name: Docs
    base_url: https://docs.example/
    documents:
      - stable_key: guide
        title: Guide A
        url: https://docs.example/a
      - stable_key: " guide "
        title: Guide B
        url: https://docs.example/b
`),
    ).toThrow('catalog source docs contains duplicate stable_key guide');
  });

  it.each([
    ['stable key', `stable_key: ${'x'.repeat(513)}`, 'CATALOG_DOCUMENT_STABLE_KEY_INVALID'],
    [
      'language',
      'stable_key: guide\n        language: not_a_language',
      'CATALOG_DOCUMENT_LANGUAGE_INVALID',
    ],
    [
      'mime type',
      `stable_key: guide\n        mime_type: ${'x'.repeat(256)}`,
      'CATALOG_DOCUMENT_MIME_TYPE_INVALID',
    ],
    [
      'URL',
      `stable_key: guide\n        url: https://docs.example/${'x'.repeat(4_100)}`,
      'CATALOG_DOCUMENT_URL_INVALID',
    ],
  ])(
    'rejects invalid %s metadata before synchronization',
    (_label, documentFields, errorCode) => {
      const urlLine = documentFields.includes('\n        url:')
        ? ''
        : '\n        url: https://docs.example/guide';
      expect(() =>
        parseCatalogSourceConfig(`
schema_version: 1
sources:
  docs:
    display_name: Docs
    base_url: https://docs.example/
    documents:
      - ${documentFields}
        title: Guide${urlLine}
`),
      ).toThrow(errorCode);
    },
  );
});
