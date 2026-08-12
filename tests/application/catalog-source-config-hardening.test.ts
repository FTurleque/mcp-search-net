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
});
