import { InvalidDomainError } from '../errors/domain-errors.js';

const DOMAIN_LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u;

export class DomainName {
  private constructor(public readonly value: string) {}

  public static create(input: string): DomainName {
    const candidate = input.trim().toLowerCase().replace(/\.$/u, '');
    if (candidate === '' || /[\s/:@?#]/u.test(candidate)) {
      throw new InvalidDomainError(`Invalid domain: ${input}`);
    }
    let ascii: string;
    try {
      ascii = new URL(`http://${candidate}`).hostname.toLowerCase().replace(/\.$/u, '');
    } catch (error) {
      throw new InvalidDomainError(`Invalid domain: ${input}`, { cause: error });
    }
    const labels = ascii.split('.');
    if (ascii === '' || ascii.length > 253 || labels.some((label) => !DOMAIN_LABEL.test(label))) {
      throw new InvalidDomainError(`Invalid domain: ${input}`);
    }
    return new DomainName(ascii);
  }

  public matches(hostname: string): boolean {
    const candidate = DomainName.create(hostname).value;
    return candidate === this.value || candidate.endsWith(`.${this.value}`);
  }
}
