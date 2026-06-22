import { InvalidSearchQueryError } from '../errors/domain-errors.js';
import { containsControlCharacters } from '../services/text-validation.js';

export class SearchQuery {
  private constructor(public readonly value: string) {}

  public static create(input: string): SearchQuery {
    if (containsControlCharacters(input)) {
      throw new InvalidSearchQueryError('The search query contains control characters');
    }
    const value = input.normalize('NFKC').trim().replace(/\s+/gu, ' ');
    if (value.length < 2 || value.length > 500) {
      throw new InvalidSearchQueryError(
        'The search query must contain between 2 and 500 characters',
      );
    }
    return new SearchQuery(value);
  }
}
