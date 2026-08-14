import type { CacheRepository } from '../ports/cache-repository.js';
import type { OfficialSourceRegistry } from '../ports/official-source-registry.js';
import type {
  SearchHistoryRecordInput,
  SearchHistoryRepository,
} from '../ports/search-history-repository.js';
import type { SearchProvider } from '../ports/search-provider.js';
import type { OperationContext, Telemetry } from '../ports/telemetry.js';
import { ApplicationError } from '../../domain/errors/domain-errors.js';
import type { SearchRequest, SearchResponse } from '../../domain/models/search.js';
import type { ToolExecution } from '../../domain/models/tool-response.js';
import { normalizeSearchRequest } from '../services/search-request.js';
import { SearchWeb, type SearchWebOptions } from './search-web.js';

export class TrackedSearchWeb extends SearchWeb {
  public constructor(
    provider: SearchProvider,
    cache: CacheRepository,
    officialSources: OfficialSourceRegistry,
    options: SearchWebOptions,
    telemetry: Telemetry | undefined,
    private readonly history: SearchHistoryRepository,
  ) {
    super(provider, cache, officialSources, options, telemetry);
  }

  public override async execute(
    request: SearchRequest,
    context: OperationContext = {},
  ): Promise<ToolExecution<SearchResponse>> {
    const normalized = normalizeSearchRequest(request);
    const startedAt = performance.now();
    const safeRequest = {
      language: normalized.language,
      timeRange: normalized.timeRange ?? null,
      maxResults: normalized.maxResults,
      sourcePolicy: normalized.sourcePolicy,
      allowedDomains: normalized.allowedDomains,
      excludedDomains: normalized.excludedDomains,
    };
    try {
      const execution = await super.execute(request, context);
      await this.record(context, {
        tool: 'search_web',
        query: normalized.query,
        request: safeRequest,
        durationMs: elapsedMilliseconds(startedAt),
        status: execution.status,
        cacheStatus: execution.cacheStatus,
        provider: execution.provider,
        resultCount: execution.data.results.length,
        warningCodes: execution.warnings.map((warning) => warning.code),
      });
      return execution;
    } catch (error) {
      await this.record(context, {
        tool: 'search_web',
        query: normalized.query,
        request: safeRequest,
        durationMs: elapsedMilliseconds(startedAt),
        status: 'failed',
        provider: 'searxng',
        warningCodes: [],
        errorCode: error instanceof ApplicationError ? error.code : 'INTERNAL_ERROR',
      });
      throw error;
    }
  }

  private async record(
    context: OperationContext,
    record: Omit<SearchHistoryRecordInput, 'requestId'>,
  ): Promise<void> {
    if (context.requestId === undefined) return;
    try {
      await this.history.append({ ...record, requestId: context.requestId });
    } catch {
      // Search history is observability data: it must never change the primary search outcome.
    }
  }
}

function elapsedMilliseconds(startedAt: number): number {
  return Math.max(0, Number((performance.now() - startedAt).toFixed(3)));
}
