import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import type {
  CatalogFreshnessPolicy,
  CatalogSourceType,
  CatalogSyncStrategy,
  NewCatalogSource,
} from '../domain/models/catalog.js';
import { validateNewCatalogSource } from '../domain/services/catalog-source-validation.js';
import { parseStrictYaml } from '../infrastructure/config/yaml-loader.js';

const SOURCE_TYPES = ['documentation', 'reference', 'api', 'guide'] as const;
const FRESHNESS_POLICIES = ['manual', 'daily', 'weekly', 'monthly'] as const;
const SYNC_STRATEGIES = ['manual', 'polling'] as const;
const ROOT_PROPERTIES = new Set(['schema_version', 'sources']);
const SOURCE_PROPERTIES = new Set([
  'display_name',
  'base_url',
  'source_type',
  'language',
  'freshness_policy',
  'sync_strategy',
  'enabled',
  'documents',
]);
const DOCUMENT_PROPERTIES = new Set([
  'stable_key',
  'title',
  'url',
  'language',
  'mime_type',
  'enabled',
]);

export interface CatalogSourceDocumentConfig {
  readonly sourceKey: string;
  readonly stableKey: string;
  readonly title: string;
  readonly url: string;
  readonly language: string;
  readonly mimeType: string;
  readonly enabled: boolean;
}

export interface CatalogSourceConfig {
  readonly sources: readonly NewCatalogSource[];
  readonly documents: readonly CatalogSourceDocumentConfig[];
}

export async function loadCatalogSourceConfig(filePath: string): Promise<CatalogSourceConfig> {
  const absolutePath = resolve(filePath);
  const content = await readFile(absolutePath, 'utf8');
  return parseCatalogSourceConfig(content);
}

export function parseCatalogSourceConfig(content: string): CatalogSourceConfig {
  const document = parseStrictYaml(content, 'catalog-sources.yml');
  const root = asRecord(document, 'catalog source config');
  assertOnlyProperties(root, ROOT_PROPERTIES, 'catalog source config');
  const schemaVersion = root['schema_version'];
  if (schemaVersion !== 1) throw new Error('catalog-sources.yml schema_version must be 1');

  const sourcesRecord = asRecord(root['sources'], 'catalog source config sources');
  const entries = Object.entries(sourcesRecord).map(([sourceKey, value]) =>
    parseCatalogSourceEntry(sourceKey, value),
  );

  if (entries.length === 0) throw new Error('catalog-sources.yml must declare at least one source');
  return {
    sources: entries.map((entry) => entry.source),
    documents: entries.flatMap((entry) => entry.documents),
  };
}

interface CatalogSourceConfigEntry {
  readonly source: NewCatalogSource;
  readonly documents: readonly CatalogSourceDocumentConfig[];
}

function parseCatalogSourceEntry(sourceKey: string, value: unknown): CatalogSourceConfigEntry {
  if (sourceKey.trim().length === 0) throw new Error('catalog source key must not be empty');
  const source = asRecord(value, `catalog source ${sourceKey}`);
  assertOnlyProperties(source, SOURCE_PROPERTIES, `catalog source ${sourceKey}`);
  const language = optionalString(source, 'language') ?? 'fr';
  let parsedSource: NewCatalogSource;
  try {
    parsedSource = validateNewCatalogSource({
      sourceKey,
      displayName: requiredString(source, 'display_name', sourceKey),
      baseUrl: requiredString(source, 'base_url', sourceKey),
      sourceType: parseSourceType(
        optionalString(source, 'source_type') ?? 'documentation',
        sourceKey,
      ),
      language,
      freshnessPolicy: parseFreshnessPolicy(
        optionalString(source, 'freshness_policy') ?? 'manual',
        sourceKey,
      ),
      syncStrategy: parseSyncStrategy(
        optionalString(source, 'sync_strategy') ?? 'manual',
        sourceKey,
      ),
      enabled: optionalBoolean(source, 'enabled') ?? true,
    });
  } catch (error) {
    if (error instanceof Error && error.message === 'CATALOG_SOURCE_BASE_URL_INVALID') {
      throw new Error(`catalog source ${sourceKey} base_url must be an HTTP(S) URL`, {
        cause: error,
      });
    }
    throw error;
  }
  return {
    source: parsedSource,
    documents: parseDocuments(sourceKey, source['documents'], language),
  };
}

function parseDocuments(
  sourceKey: string,
  value: unknown,
  sourceLanguage: string,
): readonly CatalogSourceDocumentConfig[] {
  if (value === undefined) return [];
  if (!Array.isArray(value))
    throw new Error(`catalog source ${sourceKey} documents must be an array`);

  const documents = value.map((entry, index) =>
    parseDocument(sourceKey, index, entry, sourceLanguage),
  );
  const stableKeys = new Set<string>();
  for (const document of documents) {
    if (stableKeys.has(document.stableKey)) {
      throw new Error(
        `catalog source ${sourceKey} contains duplicate stable_key ${document.stableKey}`,
      );
    }
    stableKeys.add(document.stableKey);
  }
  return documents;
}

function parseDocument(
  sourceKey: string,
  index: number,
  value: unknown,
  sourceLanguage: string,
): CatalogSourceDocumentConfig {
  const context = `catalog source ${sourceKey} document ${index + 1}`;
  const document = asRecord(value, context);
  assertOnlyProperties(document, DOCUMENT_PROPERTIES, context);
  const stableKey = requiredString(document, 'stable_key', sourceKey);
  return {
    sourceKey,
    stableKey,
    title: requiredString(document, 'title', sourceKey),
    url: validateDocumentUrl(requiredString(document, 'url', sourceKey), sourceKey, index),
    language: optionalString(document, 'language') ?? sourceLanguage,
    mimeType: optionalString(document, 'mime_type') ?? 'text/html',
    enabled: optionalBoolean(document, 'enabled') ?? true,
  };
}

function asRecord(value: unknown, context: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${context} must be an object`);
  }
  return value as Record<string, unknown>;
}

function assertOnlyProperties(
  source: Record<string, unknown>,
  allowed: ReadonlySet<string>,
  context: string,
): void {
  const unknown = Object.keys(source).filter((property) => !allowed.has(property));
  if (unknown.length === 0) return;
  throw new Error(
    `${context} contains unknown propert${unknown.length === 1 ? 'y' : 'ies'}: ${unknown.join(', ')}`,
  );
}

function requiredString(
  source: Record<string, unknown>,
  propertyName: string,
  sourceKey: string,
): string {
  const value = optionalString(source, propertyName);
  if (value === undefined || value.length === 0) {
    throw new Error(`catalog source ${sourceKey} must define ${propertyName}`);
  }
  return value;
}

function optionalString(source: Record<string, unknown>, propertyName: string): string | undefined {
  const value = source[propertyName];
  if (value === undefined) return undefined;
  if (typeof value !== 'string') throw new Error(`${propertyName} must be a string`);
  return value.trim();
}

function optionalBoolean(
  source: Record<string, unknown>,
  propertyName: string,
): boolean | undefined {
  const value = source[propertyName];
  if (value === undefined) return undefined;
  if (typeof value !== 'boolean') throw new Error(`${propertyName} must be a boolean`);
  return value;
}

function validateDocumentUrl(value: string, sourceKey: string, index: number): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`catalog source ${sourceKey} document ${index + 1} url must be an HTTP(S) URL`);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`catalog source ${sourceKey} document ${index + 1} url must be an HTTP(S) URL`);
  }
  if (url.username !== '' || url.password !== '') {
    throw new Error(
      `catalog source ${sourceKey} document ${index + 1} url must not contain credentials`,
    );
  }
  return url.toString();
}

function parseSourceType(value: string, sourceKey: string): CatalogSourceType {
  if (SOURCE_TYPES.includes(value as CatalogSourceType)) return value as CatalogSourceType;
  throw new Error(`catalog source ${sourceKey} has invalid source_type ${value}`);
}

function parseFreshnessPolicy(value: string, sourceKey: string): CatalogFreshnessPolicy {
  if (FRESHNESS_POLICIES.includes(value as CatalogFreshnessPolicy)) {
    return value as CatalogFreshnessPolicy;
  }
  throw new Error(`catalog source ${sourceKey} has invalid freshness_policy ${value}`);
}

function parseSyncStrategy(value: string, sourceKey: string): CatalogSyncStrategy {
  if (SYNC_STRATEGIES.includes(value as CatalogSyncStrategy)) return value as CatalogSyncStrategy;
  throw new Error(`catalog source ${sourceKey} has invalid sync_strategy ${value}`);
}