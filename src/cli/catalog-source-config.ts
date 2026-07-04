import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { parse } from 'yaml';

import type {
  CatalogFreshnessPolicy,
  CatalogSourceType,
  CatalogSyncStrategy,
  NewCatalogSource,
} from '../domain/models/catalog.js';

const SOURCE_TYPES = ['documentation', 'reference', 'api', 'guide'] as const;
const FRESHNESS_POLICIES = ['manual', 'daily', 'weekly', 'monthly'] as const;
const SYNC_STRATEGIES = ['manual', 'polling'] as const;

export interface CatalogSourceConfig {
  readonly sources: readonly NewCatalogSource[];
}

export async function loadCatalogSourceConfig(filePath: string): Promise<CatalogSourceConfig> {
  const absolutePath = resolve(filePath);
  const content = await readFile(absolutePath, 'utf8');
  return parseCatalogSourceConfig(content);
}

export function parseCatalogSourceConfig(content: string): CatalogSourceConfig {
  const document = parse(content) as unknown;
  const root = asRecord(document, 'catalog source config');
  const schemaVersion = root['schema_version'];
  if (schemaVersion !== 1) throw new Error('catalog-sources.yml schema_version must be 1');

  const sourcesRecord = asRecord(root['sources'], 'catalog source config sources');
  const sources = Object.entries(sourcesRecord).map(([sourceKey, value]) =>
    parseCatalogSource(sourceKey, value),
  );

  if (sources.length === 0) throw new Error('catalog-sources.yml must declare at least one source');
  return { sources };
}

function parseCatalogSource(sourceKey: string, value: unknown): NewCatalogSource {
  if (sourceKey.trim().length === 0) throw new Error('catalog source key must not be empty');
  const source = asRecord(value, `catalog source ${sourceKey}`);
  return {
    sourceKey,
    displayName: requiredString(source, 'display_name', sourceKey),
    baseUrl: validateHttpUrl(requiredString(source, 'base_url', sourceKey), sourceKey),
    sourceType: parseSourceType(optionalString(source, 'source_type') ?? 'documentation', sourceKey),
    language: optionalString(source, 'language') ?? 'fr',
    freshnessPolicy: parseFreshnessPolicy(
      optionalString(source, 'freshness_policy') ?? 'manual',
      sourceKey,
    ),
    syncStrategy: parseSyncStrategy(optionalString(source, 'sync_strategy') ?? 'manual', sourceKey),
    enabled: optionalBoolean(source, 'enabled') ?? true,
  };
}

function asRecord(value: unknown, context: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${context} must be an object`);
  }
  return value as Record<string, unknown>;
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

function optionalBoolean(source: Record<string, unknown>, propertyName: string): boolean | undefined {
  const value = source[propertyName];
  if (value === undefined) return undefined;
  if (typeof value !== 'boolean') throw new Error(`${propertyName} must be a boolean`);
  return value;
}

function validateHttpUrl(value: string, sourceKey: string): string {
  try {
    const url = new URL(value);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      throw new Error('unsupported protocol');
    }
    return url.toString();
  } catch {
    throw new Error(`catalog source ${sourceKey} base_url must be an HTTP(S) URL`);
  }
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
