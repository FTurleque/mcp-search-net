import { describe, expect, it } from 'vitest';

import { parseCatalogSourceConfig } from '../../src/cli/catalog-source-config.js';

describe('catalog source YAML hardening', () => {
  it('rejects YAML aliases instead of materializing shared structures', () => {
    expect(() =>
      parseCatalogSourceConfig(`
schema_version: 1
sources:
  primary: &source
    display_name: Primary
    base_url: https://example.test/docs/
  duplicate: *source
`),
    ).toThrow('Cannot materialize YAML document: catalog-sources.yml');
  });

  it('rejects credentials embedded in document URLs without echoing the secret', () => {
    const secret = 'top-secret';
    const parse = () =>
      parseCatalogSourceConfig(`
schema_version: 1
sources:
  primary:
    display_name: Primary
    base_url: https://example.test/docs/
    documents:
      - stable_key: guide
        title: Guide
        url: https://user:${secret}@example.test/docs/guide
`);

    expect(parse).toThrow('catalog source primary document 1 url must not contain credentials');
    try {
      parse();
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).not.toContain(secret);
    }
  });

  it('rejects percent-encoded credentials in document URLs', () => {
    expect(() =>
      parseCatalogSourceConfig(`
schema_version: 1
sources:
  primary:
    display_name: Primary
    base_url: https://example.test/docs/
    documents:
      - stable_key: guide
        title: Guide
        url: https://user:p%40ss@example.test/docs/guide
`),
    ).toThrow('catalog source primary document 1 url must not contain credentials');
  });
});
