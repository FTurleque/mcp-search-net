import type { CatalogRepository } from '../ports/catalog-repository.js';
import type {
  CatalogDocumentSearchQuery,
  CatalogDocumentSearchResult,
} from '../../domain/models/catalog.js';
import { HashedLexicalVectorizer } from '../../domain/search/hashed-lexical-vectorizer.js';

const DEFAULT_LIMIT = 10;
const DEFAULT_CANDIDATE_MULTIPLIER = 4;
const LEXICAL_MATCH_WEIGHT = 0.65;
const HASHED_LEXICAL_WEIGHT = 0.35;

export interface RerankedSearchCatalogDocumentsInput {
  readonly query: string;
  readonly sourceKey?: string;
  readonly language?: string;
  readonly limit?: number;
  readonly candidateLimit?: number;
}

export interface RerankedSearchCatalogDocumentsOutput {
  readonly schemaVersion: '2.0';
  readonly query: string;
  readonly strategy: 'fts5-hashed-lexical-rerank';
  readonly resultCount: number;
  readonly results: readonly RerankedSearchCatalogDocumentsItem[];
}

export interface RerankedSearchCatalogDocumentsItem {
  readonly sourceKey: string;
  readonly documentPublicId: string;
  readonly title: string;
  readonly url: string;
  readonly heading?: string;
  readonly lexicalScore: number;
  readonly rerankScore: number;
  readonly combinedScore: number;
  readonly snippet: string;
}

export class RerankedSearchCatalogDocuments {
  private readonly vectorizer = new HashedLexicalVectorizer();

  public constructor(private readonly repository: Pick<CatalogRepository, 'searchDocuments'>) {}

  public async execute(
    input: RerankedSearchCatalogDocumentsInput,
  ): Promise<RerankedSearchCatalogDocumentsOutput> {
    const query = input.query.trim();
    if (query.length === 0) throw new Error('Reranked catalog search query must not be empty');

    const limit = normalizeLimit(input.limit);
    const candidateLimit = Math.max(
      normalizeLimit(input.candidateLimit, limit * DEFAULT_CANDIDATE_MULTIPLIER),
      limit,
    );

    const searchQuery: CatalogDocumentSearchQuery = {
      query,
      ...(input.sourceKey === undefined ? {} : { sourceKey: input.sourceKey }),
      ...(input.language === undefined ? {} : { language: input.language }),
      limit: candidateLimit,
    };
    const candidates = await this.repository.searchDocuments(searchQuery);
    const ranked = this.rank(query, candidates).slice(0, limit);

    return {
      schemaVersion: '2.0',
      query,
      strategy: 'fts5-hashed-lexical-rerank',
      resultCount: ranked.length,
      results: ranked,
    };
  }

  private rank(
    query: string,
    candidates: readonly CatalogDocumentSearchResult[],
  ): readonly RerankedSearchCatalogDocumentsItem[] {
    const queryVector = this.vectorizer.encode(query);
    const maxLexicalScore = Math.max(1, ...candidates.map((candidate) => candidate.score));

    return candidates
      .map((candidate) => {
        const rerankText = [
          candidate.document.title,
          candidate.section.heading,
          candidate.section.headingPath,
          candidate.snippet,
          candidate.section.content,
        ]
          .filter((part): part is string => part !== undefined && part.length > 0)
          .join(' ');
        const rerankScore = Math.max(
          0,
          this.vectorizer.similarity(queryVector, this.vectorizer.encode(rerankText)),
        );
        const lexicalScore = candidate.score / maxLexicalScore;
        return {
          sourceKey: candidate.source.sourceKey,
          documentPublicId: candidate.document.publicId,
          title: candidate.document.title,
          url: candidate.document.canonicalUrl,
          ...(candidate.section.heading === undefined
            ? {}
            : { heading: candidate.section.heading }),
          lexicalScore,
          rerankScore,
          combinedScore:
            lexicalScore * LEXICAL_MATCH_WEIGHT + rerankScore * HASHED_LEXICAL_WEIGHT,
          snippet: candidate.snippet,
        };
      })
      .sort((left, right) => right.combinedScore - left.combinedScore);
  }
}

function normalizeLimit(value: number | undefined, fallback = DEFAULT_LIMIT): number {
  if (value === undefined) return fallback;
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`Invalid limit ${value}`);
  return value;
}
