import type {
  SearchHistoryListQuery,
  SearchHistoryRepository,
  SearchHistoryStatus,
  SearchHistoryTool,
} from '../ports/search-history-repository.js';
import type { CacheStatus, ToolWarningCode } from '../../domain/models/tool-response.js';
import { InvalidArgumentError } from '../../domain/errors/domain-errors.js';

export interface ListSearchHistoryInput {
  readonly tool?: SearchHistoryTool;
  readonly status?: SearchHistoryStatus;
  readonly cacheStatus?: CacheStatus;
  readonly from?: Date;
  readonly to?: Date;
  readonly queryContains?: string;
  readonly limit?: number;
  readonly beforeId?: number;
}

export interface ListSearchHistoryEntry {
  readonly id: number;
  readonly requestId: string;
  readonly tool: SearchHistoryTool;
  readonly query: string;
  readonly request: Readonly<Record<string, unknown>>;
  readonly executedAt: string;
  readonly durationMs: number;
  readonly status: SearchHistoryStatus;
  readonly cacheStatus: CacheStatus | null;
  readonly provider: string;
  readonly resultCount: number | null;
  readonly warningCodes: readonly ToolWarningCode[];
  readonly errorCode: string | null;
}

export interface ListSearchHistoryOutput {
  readonly enabled: boolean;
  readonly available: boolean;
  readonly count: number;
  readonly total: number;
  readonly nextBeforeId: number | null;
  readonly searches: readonly ListSearchHistoryEntry[];
}

export class ListSearchHistory {
  public constructor(private readonly repository: SearchHistoryRepository) {}

  public async execute(input: ListSearchHistoryInput): Promise<ListSearchHistoryOutput> {
    const limit = input.limit ?? 20;
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 50) {
      throw new InvalidArgumentError('limit must be an integer between 1 and 50');
    }
    if (
      input.beforeId !== undefined &&
      (!Number.isSafeInteger(input.beforeId) || input.beforeId <= 0)
    ) {
      throw new InvalidArgumentError('beforeId must be a positive integer');
    }
    if (input.from !== undefined && Number.isNaN(input.from.getTime())) {
      throw new InvalidArgumentError('from must be a valid date');
    }
    if (input.to !== undefined && Number.isNaN(input.to.getTime())) {
      throw new InvalidArgumentError('to must be a valid date');
    }
    if (input.from !== undefined && input.to !== undefined && input.from > input.to) {
      throw new InvalidArgumentError('from must be before or equal to to');
    }
    const queryContains = input.queryContains?.trim();
    const query: SearchHistoryListQuery = {
      limit,
      ...(input.tool === undefined ? {} : { tool: input.tool }),
      ...(input.status === undefined ? {} : { status: input.status }),
      ...(input.cacheStatus === undefined ? {} : { cacheStatus: input.cacheStatus }),
      ...(input.from === undefined ? {} : { from: input.from }),
      ...(input.to === undefined ? {} : { to: input.to }),
      ...(queryContains === undefined || queryContains === '' ? {} : { queryContains }),
      ...(input.beforeId === undefined ? {} : { beforeId: input.beforeId }),
    };
    const page = await this.repository.list(query);
    return {
      enabled: page.enabled,
      available: page.available,
      count: page.items.length,
      total: page.total,
      nextBeforeId: page.nextBeforeId ?? null,
      searches: page.items.map((entry) => ({
        id: entry.id,
        requestId: entry.requestId,
        tool: entry.tool,
        query: entry.query,
        request: entry.request,
        executedAt: entry.executedAt.toISOString(),
        durationMs: entry.durationMs,
        status: entry.status,
        cacheStatus: entry.cacheStatus ?? null,
        provider: entry.provider,
        resultCount: entry.resultCount ?? null,
        warningCodes: entry.warningCodes,
        errorCode: entry.errorCode ?? null,
      })),
    };
  }
}
