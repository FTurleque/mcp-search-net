import type {
  CatalogFreshnessPolicy,
  CatalogSourceType,
  CatalogSyncStrategy,
  NewCatalogSource,
} from '../models/catalog.js';
import { normalizeLanguageTag } from './language-tag.js';

const SOURCE_TYPES = new Set<CatalogSourceType>(['documentation', 'reference', 'api', 'guide']);
const FRESHNESS_POLICIES = new Set<CatalogFreshnessPolicy>([
  'manual',
  'daily',
  'weekly',
  'monthly',
]);
const SYNC_STRATEGIES = new Set<CatalogSyncStrategy>(['manual', 'polling']);
const SOURCE_KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;

export function validateNewCatalogSource(source: NewCatalogSource): NewCatalogSource {
  const sourceKey = source.sourceKey.trim();
  const displayName = source.displayName.trim();
  const language = normalizeLanguageTag(source.language, 'CATALOG_SOURCE_LANGUAGE_INVALID');
  if (!SOURCE_KEY_PATTERN.test(sourceKey)) throw new Error('CATALOG_SOURCE_KEY_INVALID');
  if (displayName.length === 0 || displayName.length > 200)
    throw new Error('CATALOG_SOURCE_DISPLAY_NAME_INVALID');
  if (!SOURCE_TYPES.has(source.sourceType)) throw new Error('CATALOG_SOURCE_TYPE_INVALID');
  if (!FRESHNESS_POLICIES.has(source.freshnessPolicy))
    throw new Error('CATALOG_SOURCE_FRESHNESS_POLICY_INVALID');
  if (!SYNC_STRATEGIES.has(source.syncStrategy))
    throw new Error('CATALOG_SOURCE_SYNC_STRATEGY_INVALID');
  if (typeof source.enabled !== 'boolean') throw new Error('CATALOG_SOURCE_ENABLED_INVALID');

  let url: URL;
  try {
    url = new URL(source.baseUrl);
  } catch {
    throw new Error('CATALOG_SOURCE_BASE_URL_INVALID');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:')
    throw new Error('CATALOG_SOURCE_BASE_URL_INVALID');
  if (url.username !== '' || url.password !== '')
    throw new Error('CATALOG_SOURCE_BASE_URL_INVALID');

  return {
    ...source,
    sourceKey,
    displayName,
    baseUrl: url.toString(),
    language,
  };
}
