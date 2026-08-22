import type Database from 'better-sqlite3';

import type {
  CatalogPage,
  CatalogSourcePageQuery,
} from '../../application/ports/catalog-repository.js';
import {
  MAX_CATALOG_PAGE_OFFSET,
  MAX_CATALOG_PAGE_SIZE,
} from '../../application/ports/catalog-repository.js';
import type { Clock } from '../../application/ports/clock.js';
import { InvalidArgumentError } from '../../domain/errors/domain-errors.js';
import type {
  CatalogFreshnessPolicy,
  CatalogSource,
  CatalogSourceType,
  CatalogSyncStrategy,
  NewCatalogSource,
} from '../../domain/models/catalog.js';
import type { CatalogSourceRow } from './catalog-row-mappers.js';
import { toCatalogSource } from './catalog-row-mappers.js';
import {
  createCatalogSourcesPageSql,
  createCountCatalogSourcesSql,
  INSERT_CATALOG_SOURCE_SQL,
  SELECT_CATALOG_SOURCE_BY_ID_SQL,
  SELECT_CATALOG_SOURCE_BY_KEY_SQL,
  SELECT_CATALOG_SOURCES_SQL,
} from './catalog-sql.js';
import type { CountRow } from './sqlite-catalog-row-views.js';

const UPDATE_CATALOG_SOURCE_SQL = `
  UPDATE catalog_sources SET
    display_name = ?,
    base_url = ?,
    source_type = ?,
    language = ?,
    freshness_policy = ?,
    sync_strategy = ?,
    enabled = ?,
    updated_at = ?
  WHERE source_key = ?
`;

type InsertCatalogSourceParams = [
  string,
  string,
  string,
  CatalogSourceType,
  string,
  CatalogFreshnessPolicy,
  CatalogSyncStrategy,
  number,
  number,
  number,
];

type UpdateCatalogSourceParams = [
  string,
  string,
  CatalogSourceType,
  string,
  CatalogFreshnessPolicy,
  CatalogSyncStrategy,
  number,
  number,
  string,
];

export class SqliteCatalogSourceStore {
  public constructor(
    private readonly database: Database.Database,
    private readonly clock: Clock,
  ) {}

  public add(source: NewCatalogSource): CatalogSource {
    const now = this.clock.now().getTime();
    this.database
      .prepare<InsertCatalogSourceParams>(INSERT_CATALOG_SOURCE_SQL)
      .run(
        source.sourceKey,
        source.displayName,
        source.baseUrl,
        source.sourceType,
        source.language,
        source.freshnessPolicy,
        source.syncStrategy,
        source.enabled ? 1 : 0,
        now,
        now,
      );

    const row = this.selectByKey(source.sourceKey);
    if (row === undefined) throw new Error('CATALOG_SOURCE_INSERT_FAILED');
    return toCatalogSource(row);
  }

  public update(source: NewCatalogSource): CatalogSource {
    const info = this.database
      .prepare<UpdateCatalogSourceParams>(UPDATE_CATALOG_SOURCE_SQL)
      .run(
        source.displayName,
        source.baseUrl,
        source.sourceType,
        source.language,
        source.freshnessPolicy,
        source.syncStrategy,
        source.enabled ? 1 : 0,
        this.clock.now().getTime(),
        source.sourceKey,
      );
    if (info.changes !== 1) throw new Error(`CATALOG_SOURCE_NOT_FOUND:${source.sourceKey}`);

    const row = this.selectByKey(source.sourceKey);
    if (row === undefined) throw new Error('CATALOG_SOURCE_UPDATE_FAILED');
    return toCatalogSource(row);
  }

  public getByKey(sourceKey: string): CatalogSource | undefined {
    const row = this.selectByKey(sourceKey);
    return row === undefined ? undefined : toCatalogSource(row);
  }

  public getById(sourceId: number): CatalogSource | undefined {
    const row = this.database
      .prepare<[number], CatalogSourceRow>(SELECT_CATALOG_SOURCE_BY_ID_SQL)
      .get(sourceId);
    return row === undefined ? undefined : toCatalogSource(row);
  }

  public list(): readonly CatalogSource[] {
    return this.database
      .prepare<[], CatalogSourceRow>(SELECT_CATALOG_SOURCES_SQL)
      .all()
      .map(toCatalogSource);
  }

  public listPage(query: CatalogSourcePageQuery): CatalogPage<CatalogSource> {
    assertPageQuery(query.offset, query.limit);
    const statement = createCatalogSourcesPageSql(query.offset, query.limit, query.enabled);
    const rows = this.database
      .prepare<(string | number)[], CatalogSourceRow>(statement.sql)
      .all(...statement.parameters);
    return {
      offset: query.offset,
      limit: query.limit,
      total: this.count(query.enabled),
      items: rows.map(toCatalogSource),
    };
  }

  public count(enabled?: boolean): number {
    const statement = createCountCatalogSourcesSql(enabled);
    const row = this.database
      .prepare<(string | number)[], CountRow>(statement.sql)
      .get(...statement.parameters);
    return row?.count ?? 0;
  }

  private selectByKey(sourceKey: string): CatalogSourceRow | undefined {
    return this.database
      .prepare<[string], CatalogSourceRow>(SELECT_CATALOG_SOURCE_BY_KEY_SQL)
      .get(sourceKey);
  }
}

function assertPageQuery(offset: number, limit: number): void {
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > MAX_CATALOG_PAGE_OFFSET) {
    throw new InvalidArgumentError('CATALOG_PAGE_OFFSET_INVALID');
  }
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_CATALOG_PAGE_SIZE) {
    throw new InvalidArgumentError('CATALOG_PAGE_LIMIT_INVALID');
  }
}
