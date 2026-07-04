import { describe, expect, it } from 'vitest';

import { parseCatalogSourceConfig } from '../../src/cli/catalog-source-config.js';

describe('parseCatalogSourceConfig', () => {
  it('parses catalog-sources.yml with defaults and explicit values', () => {
    const config = parseCatalogSourceConfig(`
schema_version: 1
sources:
  sample-docs:
    display_name: Sample Documentation
    base_url: https://example.test/docs/
  api-docs:
    display_name: API Documentation
    base_url: https://example.test/api/
    source_type: api
    language: en-US
    freshness_policy: weekly
    sync_strategy: polling
    enabled: false
`);

    expect(config.sources).toEqual([
      {
        sourceKey: 'sample-docs',
        displayName: 'Sample Documentation',
        baseUrl: 'https://example.test/docs/',
        sourceType: 'documentation',
        language: 'fr',
        freshnessPolicy: 'manual',
        syncStrategy: 'manual',
        enabled: true,
      },
      {
        sourceKey: 'api-docs',
        displayName: 'API Documentation',
        baseUrl: 'https://example.test/api/',
        sourceType: 'api',
        language: 'en-US',
        freshnessPolicy: 'weekly',
        syncStrategy: 'polling',
        enabled: false,
      },
    ]);
  });

  it('rejects unsupported schema versions', () => {
    expect(() =>
      parseCatalogSourceConfig(`
schema_version: 2
sources: {}
`),
    ).toThrow('schema_version must be 1');
  });

  it('rejects non HTTP base URLs', () => {
    expect(() =>
      parseCatalogSourceConfig(`
schema_version: 1
sources:
  bad:
    display_name: Bad
    base_url: file:///tmp/docs
`),
    ).toThrow('base_url must be an HTTP(S) URL');
  });
});
