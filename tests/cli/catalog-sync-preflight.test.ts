import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  parseResumeFingerprint,
  preloadCatalogSourceConfig,
} from '../../src/cli/catalog-sync-preflight.js';

const roots: string[] = [];
const CURSOR = { sourceKey: 'openai', stableKey: 'overview' } as const;
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

afterEach(() => {
  roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true }));
});

describe('catalog sync CLI preflight', () => {
  it('does nothing for commands that do not consume catalog source configuration', async () => {
    await expect(
      preloadCatalogSourceConfig('status', undefined, undefined),
    ).resolves.toBeUndefined();
  });

  it('preloads load-sources configuration before repository construction', async () => {
    const filePath = createConfig();
    await expect(
      preloadCatalogSourceConfig('load-sources', filePath, undefined),
    ).resolves.toMatchObject({
      sources: [{ sourceKey: 'openai' }],
      documents: [{ sourceKey: 'openai', stableKey: 'overview' }],
    });
  });

  it('preloads sync configuration before repository construction', async () => {
    const filePath = createConfig();
    await expect(preloadCatalogSourceConfig('sync', undefined, filePath)).resolves.toMatchObject({
      documents: [{ sourceKey: 'openai', stableKey: 'overview' }],
    });
  });

  it('fails closed when sync has no source config file', async () => {
    await expect(preloadCatalogSourceConfig('sync', undefined, undefined)).rejects.toThrow(
      'catalog sync requires --file <catalog-sources.yml>',
    );
  });

  it('fails closed when load-sources has no source config file', async () => {
    await expect(preloadCatalogSourceConfig('load-sources', undefined, undefined)).rejects.toThrow(
      'catalog load-sources requires a source config file',
    );
  });

  it('requires the resume cursor and fingerprint as one atomic pair', () => {
    expect(parseResumeFingerprint(undefined, undefined)).toBeUndefined();
    expect(() => parseResumeFingerprint('a'.repeat(64), undefined)).toThrow(
      '--resume-fingerprint requires --resume-after',
    );
    expect(() => parseResumeFingerprint(undefined, CURSOR)).toThrow(
      '--resume-after requires --resume-fingerprint from the previous sync output',
    );
  });

  it('rejects malformed fingerprints and normalizes valid hexadecimal input', () => {
    expect(() => parseResumeFingerprint('not-a-sha256', CURSOR)).toThrow(
      '--resume-fingerprint must be a SHA-256 hexadecimal value',
    );
    expect(parseResumeFingerprint('A'.repeat(64), CURSOR)).toBe('a'.repeat(64));
  });
});

function createConfig(): string {
  const root = mkdtempSync(join(tmpdir(), 'mcp-catalog-preflight-'));
  roots.push(root);
  const filePath = join(root, 'catalog-sources.yml');
  writeFileSync(filePath, VALID_CONFIG, 'utf8');
  return filePath;
}
