import { InvalidDomainError } from '../errors/domain-errors.js';

const DOMAIN_LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u;

export class DomainName {
  private constructor(public readonly value: string) {}

  public static create(input: string): DomainName {
    const candidate = input.trim().toLowerCase().replace(/\.$/u, '');
    const address = stripIpv6Brackets(candidate);
    if (isIpAddress(address)) return new DomainName(address);
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
    if (isIpAddress(this.value) || isIpAddress(candidate)) return candidate === this.value;
    return candidate === this.value || candidate.endsWith(`.${this.value}`);
  }
}

function stripIpv6Brackets(value: string): string {
  return value.startsWith('[') && value.endsWith(']') ? value.slice(1, -1) : value;
}

function isIpAddress(value: string): boolean {
  return isIpv4Address(value) || isIpv6Address(value);
}

function isIpv4Address(value: string): boolean {
  const parts = value.split('.');
  return (
    parts.length === 4 &&
    parts.every(
      (part) => /^(?:0|[1-9]\d{0,2})$/u.test(part) && Number(part) >= 0 && Number(part) <= 255,
    )
  );
}

function isIpv6Address(value: string): boolean {
  const zoneIndex = value.indexOf('%');
  const address = zoneIndex < 0 ? value : value.slice(0, zoneIndex);
  const zone = zoneIndex < 0 ? undefined : value.slice(zoneIndex + 1);
  if (zone !== undefined && (zone === '' || value.slice(zoneIndex + 1).includes('%'))) return false;

  const halves = address.split('::');
  if (halves.length > 2) return false;
  const left = ipv6Groups(halves[0] ?? '');
  const right = ipv6Groups(halves[1] ?? '');
  if (left === undefined || right === undefined) return false;
  const explicitGroups = left.length + right.length;
  return halves.length === 2 ? explicitGroups < 8 : explicitGroups === 8;
}

function ipv6Groups(half: string): readonly string[] | undefined {
  if (half === '') return [];
  const groups = half.split(':');
  const finalGroup = groups.at(-1);
  if (finalGroup?.includes('.') === true) {
    if (!isIpv4Address(finalGroup)) return undefined;
    groups.splice(-1, 1, '0', '0');
  }
  return groups.every((group) => /^[0-9a-f]{1,4}$/iu.test(group)) ? groups : undefined;
}
