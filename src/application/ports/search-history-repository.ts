import type { CacheStatus, ToolWarningCode } from '../../domain/models/tool-response.js';

export const SEARCH_HISTORY_TOOLS = ['search_web', 'search_docs'] as const;
export type SearchHistoryTool = (typeof SEARCH_HISTORY_TOOLS)[number];
export const SEARCH_HISTORY_STATUSES = ['success', 'partial', 'failed'] as const;
export type SearchHistoryStatus = (typeof SEARCH_HISTORY_STATUSES)[number];

export interface SearchHistoryRecordInput {
  readonly requestId: string;
  readonly tool: SearchHistoryTool;
  readonly query: string;
  readonly request: Readonly<Record<string, unknown>>;
  readonly durationMs: number;
  readonly status: SearchHistoryStatus;
  readonly cacheStatus?: CacheStatus;
  readonly provider: string;
  readonly resultCount?: number;
  readonly warningCodes: readonly ToolWarningCode[];
  readonly errorCode?: string;
}

export interface SearchHistoryEntry extends SearchHistoryRecordInput {
  readonly id: number;
  readonly executedAt: Date;
}

export interface SearchHistoryListQuery {
  readonly tool?: SearchHistoryTool;
  readonly status?: SearchHistoryStatus;
  readonly cacheStatus?: CacheStatus;
  readonly from?: Date;
  readonly to?: Date;
  readonly queryContains?: string;
  readonly limit: number;
  readonly beforeId?: number;
}

export interface SearchHistoryPage {
  readonly enabled: boolean;
  readonly available: boolean;
  readonly items: readonly SearchHistoryEntry[];
  readonly total: number;
  readonly nextBeforeId?: number;
}

export interface SearchHistoryRepository {
  readonly enabled: boolean;
  append(record: SearchHistoryRecordInput): Promise<boolean>;
  list(query: SearchHistoryListQuery): Promise<SearchHistoryPage>;
  close(): void;
}

export class DisabledSearchHistoryRepository implements SearchHistoryRepository {
  public readonly enabled = false;

  public append(_record: SearchHistoryRecordInput): Promise<boolean> {
    return Promise.resolve(false);
  }

  public list(_query: SearchHistoryListQuery): Promise<SearchHistoryPage> {
    return Promise.resolve({
      enabled: false,
      available: true,
      items: [],
      total: 0,
    });
  }

  public close(): void {}
}
