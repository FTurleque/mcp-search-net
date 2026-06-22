import { InvalidArgumentError } from '../errors/domain-errors.js';

export class RelevanceScore {
  private constructor(public readonly value: number) {}

  public static create(value: number): RelevanceScore {
    if (!Number.isFinite(value) || value < 0 || value > 1) {
      throw new InvalidArgumentError('A relevance score must be finite and between 0 and 1');
    }
    return new RelevanceScore(value);
  }

  public static clamp(value: number): RelevanceScore {
    const finite = Number.isFinite(value) ? value : 0;
    return new RelevanceScore(Number(Math.min(1, Math.max(0, finite)).toFixed(6)));
  }

  public compare(other: RelevanceScore): number {
    return this.value - other.value;
  }
}
