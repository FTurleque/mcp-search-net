import { describe, expect, it } from 'vitest';

import type { NewCatalogSource } from '../../src/domain/models/catalog.js';
import { validateNewCatalogSource } from '../../src/domain/services/catalog-source-validation.js';

const validSource: NewCatalogSource = {
  sourceKey: 'sample-docs',
  displayName: 'Sample docs',
  baseUrl: 'https://example.test/docs',
  sourceType: 'documentation',
  language: 'en-US',
  freshnessPolicy: 'weekly',
  syncStrategy: 'manual',
  enabled: true,
};

describe('validateNewCatalogSource', () => {
  it.each(['https://example.test/docs', 'http://example.test/docs'])(
    'accepts and canonicalizes catalog base URL %s',
    (baseUrl) => {
      expect(validateNewCatalogSource({ ...validSource, baseUrl }).baseUrl).toBe(
        new URL(baseUrl).toString(),
      );
    },
  );

  it.each(['', 'not a URL', 'file:///tmp/docs', 'javascript:alert(1)'])(
    'rejects invalid catalog base URL %s',
    (baseUrl) => {
      expect(() => validateNewCatalogSource({ ...validSource, baseUrl })).toThrow(
        'CATALOG_SOURCE_BASE_URL_INVALID',
      );
    },
  );

  it('enforces source key, display name, language and runtime enum invariants', () => {
    expect(() => validateNewCatalogSource({ ...validSource, sourceKey: ' ' })).toThrow(
      'CATALOG_SOURCE_KEY_INVALID',
    );
    expect(() => validateNewCatalogSource({ ...validSource, displayName: ' ' })).toThrow(
      'CATALOG_SOURCE_DISPLAY_NAME_INVALID',
    );
    expect(() =>
      validateNewCatalogSource({ ...validSource, language: 'not a language tag!' }),
    ).toThrow('CATALOG_SOURCE_LANGUAGE_INVALID');
    expect(() =>
      validateNewCatalogSource({ ...validSource, sourceType: 'other' as 'documentation' }),
    ).toThrow('CATALOG_SOURCE_TYPE_INVALID');
    expect(() =>
      validateNewCatalogSource({ ...validSource, freshnessPolicy: 'hourly' as 'manual' }),
    ).toThrow('CATALOG_SOURCE_FRESHNESS_POLICY_INVALID');
    expect(() =>
      validateNewCatalogSource({ ...validSource, syncStrategy: 'push' as 'manual' }),
    ).toThrow('CATALOG_SOURCE_SYNC_STRATEGY_INVALID');
  });
});
