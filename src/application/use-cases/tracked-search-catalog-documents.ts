import type { CatalogRepository } from '../ports/catalog-repository.js';
import type {
  SearchHistoryRecordInput,
  SearchHistoryRepository,
} from '../ports/search-history-repository.js';
import type { OperationContext } from '../ports/telemetry.js';
import { ApplicationError } from '../../domain/errors/domain-errors.js';
import {
  SearchCatalogDocuments,
  type SearchCatalogDocumentsInput,
  type SearchCatalogDocumentsOutput,
} from './search-catalog-documents.js';

export class TrackedSearchCatalogDocuments extends SearchCatalogDocuments {
  public constructor(
    repository: Pick<CatalogRepository, 'searchDocuments'>,
    private readonly history: SearchHistoryRepository,
  ) {
    super(repository);
  }

  public override async execute(
    input: SearchCatalogDocumentsInput,
    context: OperationContext = {},
  ): Promise<SearchCatalogDocumentsOutput> {
    const query = input.query.trim();
    if (query.length === 0) return super.execute(input);
    const startedAt = performance.now();
    try {
      const output = await super.execute(input);
      await this.record(context, {
        tool: 'search_docs',
        query: output.query,
        request: {
          sourceKey: input.sourceKey ?? null,
          language: input.language ?? null,
          maxResults: input.limit ?? null,
        },
        durationMs: elapsedMilliseconds(startedAt),
        status: 'success',
        cacheStatus: 'DISABLED',
        provider: 'catalog',
        resultCount: output.resultCount,
        warningCodes: [],
      });
      return output;
    } catch (error) {
      await this.record(context, {
        tool: 'search_docs',
        query,
        request: {
          sourceKey: input.sourceKey ?? null,
          language: input.language ?? null,
          maxResults: input.limit ?? null,
        },
        durationMs: elapsedMilliseconds(startedAt),
        status: 'failed',
        provider: 'catalog',
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
