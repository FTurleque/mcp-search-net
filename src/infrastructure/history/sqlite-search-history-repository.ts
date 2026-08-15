import { chmodSync, existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

import Database from 'better-sqlite3';

import type { Clock } from '../../application/ports/clock.js';
import type {
  SearchHistoryEntry,
  SearchHistoryListQuery,
  SearchHistoryPage,
  SearchHistoryRecordInput,
  SearchHistoryRepository,
  SearchHistoryStatus,
  SearchHistoryTool,
} from '../../application/ports/search-history-repository.js';
import {
  CACHE_STATUSES,
  TOOL_WARNING_CODES,
  type CacheStatus,
  type ToolWarningCode,
} from '../../domain/models/tool-response.js';
import { configureSqliteConnection, SQLITE_BUSY_TIMEOUT_MS } from '../sqlite-connection.js';
import { HistoryMigrationRunner } from './history-migration-runner.js';

interface HistoryRow {
  readonly id: number;
  readonly request_id: string;
  readonly tool: string;
  readonly query: string;
  readonly request_json: string;
  readonly executed_at: number;
  readonly duration_ms: number;
  readonly status: string;
  readonly cache_status: string | null;
  readonly provider: string;
  readonly result_count: number | null;
  readonly warning_codes_json: string;
  readonly error_code: string | null;
}

interface CountRow {
  readonly total: number;
}

export class SqliteSearchHistoryRepository implements SearchHistoryRepository {
  public readonly enabled = true;
  private readonly database: Database.Database;
  private readonly insertStatement: Database.Statement<
    [
      string,
      string,
      string,
      string,
      number,
      number,
      string,
      string | null,
      string,
      number | null,
      string,
      string | null,
    ]
  >;
  private readonly deleteExpiredStatement: Database.Statement<[number]>;
  private readonly deleteOverflowStatement: Database.Statement<[number]>;

  public constructor(
    private readonly path: string,
    private readonly clock: Clock,
    private readonly retentionDays: number,
    private readonly maxEntries: number,
  ) {
    if (!Number.isSafeInteger(retentionDays) || retentionDays < 1 || retentionDays > 3_650) {
      throw new RangeError('retentionDays must be an integer between 1 and 3650');
    }
    if (!Number.isSafeInteger(maxEntries) || maxEntries < 100 || maxEntries > 1_000_000) {
      throw new RangeError('maxEntries must be an integer between 100 and 1000000');
    }
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    this.database = new Database(path, { timeout: SQLITE_BUSY_TIMEOUT_MS });
    try {
      hardenHistoryStoragePermissions(path);
      configureSqliteConnection(this.database);
      new HistoryMigrationRunner(this.database, this.clock).apply();
      hardenHistoryStoragePermissions(path);
    } catch (error) {
      if (this.database.open) this.database.close();
      throw error;
    }

    this.insertStatement = this.database.prepare(
      `INSERT INTO search_history (
        request_id, tool, query, request_json, executed_at, duration_ms, status, cache_status,
        provider, result_count, warning_codes_json, error_code
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    this.deleteExpiredStatement = this.database.prepare(
      'DELETE FROM search_history WHERE executed_at < ?',
    );
    this.deleteOverflowStatement = this.database.prepare(
      `DELETE FROM search_history
       WHERE id IN (
         SELECT id FROM search_history
         ORDER BY id DESC
         LIMIT -1 OFFSET ?
       )`,
    );
  }

  public append(record: SearchHistoryRecordInput): Promise<boolean> {
    assertRecord(record);
    const executedAt = this.clock.now().getTime();
    this.database.transaction(() => {
      this.insertStatement.run(
        record.requestId,
        record.tool,
        record.query,
        JSON.stringify(record.request),
        executedAt,
        record.durationMs,
        record.status,
        record.cacheStatus ?? null,
        record.provider,
        record.resultCount ?? null,
        JSON.stringify(record.warningCodes),
        record.errorCode ?? null,
      );
      this.pruneExpired(executedAt);
      this.deleteOverflowStatement.run(this.maxEntries);
    })();
    hardenHistoryStoragePermissions(this.path);
    return Promise.resolve(true);
  }

  public list(query: SearchHistoryListQuery): Promise<SearchHistoryPage> {
    const retentionCutoff = this.clock.now().getTime() - this.retentionDays * 86_400_000;
    const { whereSql, parameters } = buildWhere(query, false, retentionCutoff);
    const countRow = this.database
      .prepare(`SELECT COUNT(*) AS total FROM search_history${whereSql}`)
      .get(...parameters) as CountRow | undefined;

    const pageWhere = buildWhere(query, true, retentionCutoff);
    const rows = this.database
      .prepare(
        `SELECT id, request_id, tool, query, request_json, executed_at, duration_ms, status,
                cache_status, provider, result_count, warning_codes_json, error_code
         FROM search_history${pageWhere.whereSql}
         ORDER BY id DESC
         LIMIT ?`,
      )
      .all(...pageWhere.parameters, query.limit + 1) as HistoryRow[];

    const hasMore = rows.length > query.limit;
    const pageRows = hasMore ? rows.slice(0, query.limit) : rows;
    const items = pageRows.map(toEntry);
    const nextBeforeId = hasMore ? items.at(-1)?.id : undefined;
    return Promise.resolve({
      enabled: true,
      available: true,
      items,
      total: countRow?.total ?? 0,
      ...(nextBeforeId === undefined ? {} : { nextBeforeId }),
    });
  }

  public close(): void {
    if (this.database.open) this.database.close();
  }

  private pruneExpired(now: number): void {
    const retentionCutoff = now - this.retentionDays * 86_400_000;
    this.deleteExpiredStatement.run(retentionCutoff);
  }
}

function hardenHistoryStoragePermissions(path: string): void {
  if (process.platform === 'win32') return;
  for (const candidate of [path, `${path}-wal`, `${path}-shm`]) {
    if (existsSync(candidate)) chmodSync(candidate, 0o600);
  }
}

function buildWhere(
  query: SearchHistoryListQuery,
  includeCursor: boolean,
  retentionCutoff: number,
): { readonly whereSql: string; readonly parameters: unknown[] } {
  const clauses: string[] = ['executed_at >= ?'];
  const parameters: unknown[] = [retentionCutoff];
  if (query.tool !== undefined) {
    clauses.push('tool = ?');
    parameters.push(query.tool);
  }
  if (query.status !== undefined) {
    clauses.push('status = ?');
    parameters.push(query.status);
  }
  if (query.cacheStatus !== undefined) {
    clauses.push('cache_status = ?');
    parameters.push(query.cacheStatus);
  }
  if (query.from !== undefined) {
    clauses.push('executed_at >= ?');
    parameters.push(query.from.getTime());
  }
  if (query.to !== undefined) {
    clauses.push('executed_at <= ?');
    parameters.push(query.to.getTime());
  }
  if (query.queryContains !== undefined) {
    clauses.push('instr(lower(query), lower(?)) > 0');
    parameters.push(query.queryContains);
  }
  if (includeCursor && query.beforeId !== undefined) {
    clauses.push('id < ?');
    parameters.push(query.beforeId);
  }
  return {
    whereSql: ` WHERE ${clauses.join(' AND ')}`,
    parameters,
  };
}

function toEntry(row: HistoryRow): SearchHistoryEntry {
  return {
    id: row.id,
    requestId: row.request_id,
    tool: row.tool as SearchHistoryTool,
    query: row.query,
    request: parseRequest(row.request_json),
    executedAt: new Date(row.executed_at),
    durationMs: row.duration_ms,
    status: row.status as SearchHistoryStatus,
    ...(row.cache_status === null ? {} : { cacheStatus: row.cache_status as CacheStatus }),
    provider: row.provider,
    ...(row.result_count === null ? {} : { resultCount: row.result_count }),
    warningCodes: parseWarningCodes(row.warning_codes_json),
    ...(row.error_code === null ? {} : { errorCode: row.error_code }),
  };
}

function parseRequest(value: string): Readonly<Record<string, unknown>> {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Readonly<Record<string, unknown>>;
    }
  } catch {
    // Corrupt rows are returned with an empty safe request payload.
  }
  return {};
}

function parseWarningCodes(value: string): readonly ToolWarningCode[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (item): item is ToolWarningCode =>
        typeof item === 'string' && (TOOL_WARNING_CODES as readonly string[]).includes(item),
    );
  } catch {
    return [];
  }
}

function assertRecord(record: SearchHistoryRecordInput): void {
  if (record.requestId.trim() === '') throw new Error('HISTORY_REQUEST_ID_REQUIRED');
  if (record.query.trim() === '') throw new Error('HISTORY_QUERY_REQUIRED');
  if (!Number.isFinite(record.durationMs) || record.durationMs < 0) {
    throw new Error('HISTORY_DURATION_INVALID');
  }
  if (
    record.resultCount !== undefined &&
    (!Number.isSafeInteger(record.resultCount) || record.resultCount < 0)
  ) {
    throw new Error('HISTORY_RESULT_COUNT_INVALID');
  }
  if (
    record.cacheStatus !== undefined &&
    !(CACHE_STATUSES as readonly string[]).includes(record.cacheStatus)
  ) {
    throw new Error('HISTORY_CACHE_STATUS_INVALID');
  }
}
