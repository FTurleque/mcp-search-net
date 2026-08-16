import type { SyncCatalogResumeCursor } from '../application/use-cases/sync-catalog-documents.js';
import {
  loadCatalogSourceConfig,
  type CatalogSourceConfig,
} from './catalog-source-config.js';

const RESUME_FINGERPRINT_PATTERN = /^[a-fA-F0-9]{64}$/u;

export async function preloadCatalogSourceConfig(
  command: string,
  loadSourcesFilePath: string | undefined,
  syncFilePath: string | undefined,
): Promise<CatalogSourceConfig | undefined> {
  if (command === 'load-sources') {
    if (loadSourcesFilePath === undefined) {
      throw new Error('catalog load-sources requires a source config file');
    }
    return loadCatalogSourceConfig(loadSourcesFilePath);
  }
  if (command === 'sync') {
    if (syncFilePath === undefined) {
      throw new Error('catalog sync requires --file <catalog-sources.yml>');
    }
    return loadCatalogSourceConfig(syncFilePath);
  }
  return undefined;
}

export function parseResumeFingerprint(
  value: string | undefined,
  resumeAfter: SyncCatalogResumeCursor | undefined,
): string | undefined {
  if (resumeAfter === undefined) {
    if (value !== undefined) throw new Error('--resume-fingerprint requires --resume-after');
    return undefined;
  }
  if (value === undefined) {
    throw new Error('--resume-after requires --resume-fingerprint from the previous sync output');
  }
  if (!RESUME_FINGERPRINT_PATTERN.test(value)) {
    throw new Error('--resume-fingerprint must be a SHA-256 hexadecimal value');
  }
  return value.toLowerCase();
}
