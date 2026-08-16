import { describe, expect, it } from 'vitest';

import { parseCatalogSourceConfig } from '../../src/cli/catalog-source-config.js';

const VALID_CONFIG = `
schema_version: 1
sources:
  openai:
    display_name: OpenAI Docs
    base_url: https://platform.openai.com/docs/
    source_type: documentation
    language: en-US
    freshness_policy: daily
    sync_strategy: polling
    enabled: true
    documents:
      - stable_key: overview
        title: Overview
        url: https://platform.openai.com/docs/overview
        language: en-US
        mime_type: text/html
        enabled: true
`;

describe('catalog source config strictness', () => {
  it('accepts the documented schema', () => {
    expect(parseCatalogSourceConfig(VALID_CONFIG)).toMatchObject({
      sources: [{ sourceKey: 'openai', enabled: true }],
      documents: [{ sourceKey: 'openai', stableKey: 'overview', enabled: true }],
    });
  });

  it('rejects unknown root properties', () => {
    expect(() => parseCatalogSourceConfig(`${VALID_CONFIG}\nunexpected_root: true\n`)).toThrow(
      'catalog source config contains unknown property: unexpected_root',
    );
  });

  it('rejects a misspelled source property instead of silently keeping the source enabled', () => {
    const config = VALID_CONFIG.replace('    enabled: true\n', '    enabledd: false\n');
    expect(() => parseCatalogSourceConfig(config)).toThrow(
      'catalog source openai contains unknown property: enabledd',
    );
  });

  it('rejects unknown document properties', () => {
    const config = VALID_CONFIG.replace(
      '        enabled: true\n',
      '        enabled: true\n        unexpected_document_key: value\n',
    );
    expect(() => parseCatalogSourceConfig(config)).toThrow(
      'catalog source openai document 1 contains unknown property: unexpected_document_key',
    );
  });

  it('rejects duplicate stable keys inside one source before synchronization can start', () => {
    const config = VALID_CONFIG.replace(
      '        enabled: true\n',
      `        enabled: true
      - stable_key: overview
        title: Duplicate overview
        url: https://platform.openai.com/docs/overview-v2
        language: en-US
        mime_type: text/html
        enabled: true
`,
    );

    expect(() => parseCatalogSourceConfig(config)).toThrow(
      'catalog source openai contains duplicate stable_key overview',
    );
  });
});
