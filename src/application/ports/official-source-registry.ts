import type { OfficialSource } from '../../domain/models/official-source.js';

export interface OfficialSourceRegistry {
  findByUrl(url: string): OfficialSource | undefined;
  findForQuery(query: string): readonly OfficialSource[];
  list(): readonly OfficialSource[];
  version(): string;
}
