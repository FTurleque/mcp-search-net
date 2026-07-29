import type { CatalogRepository } from '../ports/catalog-repository.js';
import type {
  CatalogDocumentSearchQuery,
  CatalogDocumentSearchResult,
} from '../../domain/models/catalog.js';
import { LocalSemanticVectorizer } from '../../domain/search/local-semantic-vectorizer.js';

const DEFAULT_LIMIT = 10;
const DEFAULT_CANDIDATE_MULTIPLIER = 4;
const LEXICAL_WEIGHT = 0.65;
const SEMANTIC_WEIGHT = 0.35;

export interface HybridSearchCatalogDocumentsInput {
  readonly query: string;
  readonly sourceKey?: string;
  readonly language?: string;
  readonly limit?: number;
  readonly candidateLimit?: number;
}

export interface HybridSearchCatalogDocumentsOutput {
  readonly schemaVersion: '1.0';
  readonly query: string;
  readonly strategy: 'lexical-semantic-hybrid';
  readonly resultCount: number;
  readonly results: readonly HybridSearchCatalogDocumentsItem[];
}

export interface HybridSearchCatalogDocumentsItem {
  readonly sourceKey: string;
  readonly documentPublicId: string;
  readonly title: string;
  readonly url: string;
  readonly heading?: string;
  readonly snippet: string;
  readonly lexicalScore: number;
  readonly semanticScore: number;
  readonly hybridScore: number;
}

export class HybridSearchCatalogDocuments {
  private readonly vectorizer = new LocalSemanticVectorizer();

  public constructor(private readonly repository: Pick<CatalogRepository, 'searchDocuments'>) {}

  public async execute(
    input: HybridSearchCatalogDocumentsInput,
  ): Promise<HybridSearchCatalogDocumentsOutput> {
    const query = input.query.trim();
    if (query.length === 0) throw new Error('Hybrid catalog search query must not be empty');

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
      schemaVersion: '1.0',
      query,
      strategy: 'lexical-semantic-hybrid',
      resultCount: ranked.length,
      results: ranked,
    };
  }

  private rank(
    query: string,
    candidates: readonly CatalogDocumentSearchResult[],
  ): readonly HybridSearchCatalogDocumentsItem[] {
    const queryVector = this.vectorizer.encode(query);
    const maxLexicalScore = Math.max(1, ...candidates.map((candidate) => candidate.score));

    return candidates
      .map((candidate) => {
        const semanticText = [
          candidate.document.title,
          candidate.section.heading,
          candidate.section.headingPath,
          candidate.snippet,
          candidate.section.content,
        ]
          .filter((part): part is string => part !== undefined && part.length > 0)
          .join(' ');
        const semanticScore = Math.max(
          0,
          this.vectorizer.similarity(queryVector, this.vectorizer.encode(semanticText)),
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
          snippet: candidate.snippet,
          lexicalScore,
          semanticScore,
          hybridScore: lexicalScore * LEXICAL_WEIGHT + semanticScore * SEMANTIC_WEIGHT,
        };
      })
      .sort((left, right) => right.hybridScore - left.hybridScore);
  }
}

function normalizeLimit(value: number | undefined, fallback = DEFAULT_LIMIT): number {
  if (value === undefined) return fallback;
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`Invalid limit ${value}`);
  return value;
}
