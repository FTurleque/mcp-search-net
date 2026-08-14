import type { Logger } from '../../application/ports/logger.js';
import type {
  SearchHistoryListQuery,
  SearchHistoryPage,
  SearchHistoryRecordInput,
  SearchHistoryRepository,
} from '../../application/ports/search-history-repository.js';

export class SafeSearchHistoryRepository implements SearchHistoryRepository {
  public readonly enabled: boolean;

  public constructor(
    private readonly inner: SearchHistoryRepository,
    private readonly logger: Logger,
  ) {
    this.enabled = inner.enabled;
  }

  public async append(record: SearchHistoryRecordInput): Promise<boolean> {
    try {
      return await this.inner.append(record);
    } catch (error) {
      this.logger.error('history_unavailable', {
        operation: 'append',
        error: error instanceof Error ? { name: error.name } : 'unknown',
      });
      return false;
    }
  }

  public async list(query: SearchHistoryListQuery): Promise<SearchHistoryPage> {
    try {
      return await this.inner.list(query);
    } catch (error) {
      this.logger.error('history_unavailable', {
        operation: 'list',
        error: error instanceof Error ? { name: error.name } : 'unknown',
      });
      return {
        enabled: this.enabled,
        available: false,
        items: [],
        total: 0,
      };
    }
  }

  public close(): void {
    try {
      this.inner.close();
    } catch {
      /* Shutdown remains best effort. */
    }
  }
}
