const DEFAULT_DIMENSIONS = 64;

const STOP_WORDS = new Set([
  'a',
  'an',
  'and',
  'au',
  'aux',
  'avec',
  'de',
  'des',
  'du',
  'en',
  'for',
  'in',
  'la',
  'le',
  'les',
  'of',
  'on',
  'ou',
  'pour',
  'the',
  'to',
  'un',
  'une',
]);

export interface HashedLexicalVectorizerOptions {
  readonly dimensions?: number;
}

export interface HashedLexicalVector {
  readonly dimensions: number;
  readonly values: readonly number[];
}

/**
 * Deterministic lexical feature hashing over normalized tokens, lightweight stems and bigrams.
 * This is intentionally not called semantic: it uses no embeddings, model or learned representation.
 */
export class HashedLexicalVectorizer {
  private readonly dimensions: number;

  public constructor(options: HashedLexicalVectorizerOptions = {}) {
    this.dimensions = options.dimensions ?? DEFAULT_DIMENSIONS;
    if (!Number.isSafeInteger(this.dimensions) || this.dimensions <= 0) {
      throw new Error('Hashed lexical vector dimensions must be a positive safe integer');
    }
  }

  public encode(text: string): HashedLexicalVector {
    const tokens = tokenize(text);
    const values = Array.from({ length: this.dimensions }, () => 0);

    for (const token of tokens) {
      addFeature(values, this.dimensions, token, 1);
      addFeature(values, this.dimensions, stem(token), 0.6);
    }

    for (let index = 0; index < tokens.length - 1; index += 1) {
      const left = tokens[index];
      const right = tokens[index + 1];
      if (left !== undefined && right !== undefined) {
        addFeature(values, this.dimensions, `${left} ${right}`, 0.75);
      }
    }

    return { dimensions: this.dimensions, values: normalize(values) };
  }

  public similarity(left: HashedLexicalVector, right: HashedLexicalVector): number {
    if (left.dimensions !== right.dimensions) {
      throw new Error('Cannot compare hashed lexical vectors with different dimensions');
    }
    return cosineSimilarity(left.values, right.values);
  }
}

function tokenize(text: string): readonly string[] {
  const normalized = text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, ' ')
    .trim();
  if (normalized.length === 0) return [];
  return normalized.split(/\s+/u).filter((token) => token.length > 1 && !STOP_WORDS.has(token));
}

function stem(token: string): string {
  return token
    .replace(/ements$/u, 'ement')
    .replace(/ations$/u, 'ation')
    .replace(/iques$/u, 'ique')
    .replace(/ments$/u, 'ment')
    .replace(/eurs$/u, 'eur')
    .replace(/ies$/u, 'y')
    .replace(/s$/u, '');
}

function addFeature(values: number[], dimensions: number, feature: string, weight: number): void {
  const hash = hashFeature(feature);
  const index = hash % dimensions;
  const sign = hash % 2 === 0 ? 1 : -1;
  values[index] = (values[index] ?? 0) + sign * weight;
}

function hashFeature(value: string): number {
  let hash = 2_166_136_261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return hash >>> 0;
}

function normalize(values: readonly number[]): readonly number[] {
  const magnitude = Math.sqrt(values.reduce((sum, value) => sum + value * value, 0));
  if (magnitude === 0) return values;
  return values.map((value) => value / magnitude);
}

function cosineSimilarity(left: readonly number[], right: readonly number[]): number {
  let score = 0;
  for (let index = 0; index < left.length; index += 1) {
    score += (left[index] ?? 0) * (right[index] ?? 0);
  }
  return score;
}
