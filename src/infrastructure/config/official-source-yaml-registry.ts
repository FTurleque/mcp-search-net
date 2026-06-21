import { createHash } from 'node:crypto';

import type { OfficialSourceRegistry } from '../../application/ports/official-source-registry.js';
import type { OfficialSource } from '../../domain/models/official-source.js';
import { ConfigurationError } from '../../domain/errors/domain-errors.js';
import type { OfficialSourcesFile } from './application-config.js';

export class OfficialSourceYamlRegistry implements OfficialSourceRegistry {
  private readonly sources: readonly OfficialSource[];
  private readonly fingerprint: string;

  public constructor(file: OfficialSourcesFile) {
    const ids = new Set<string>();
    this.sources = file.sources.map((source) => {
      if (ids.has(source.id)) {
        throw new ConfigurationError(`Duplicate official source id: ${source.id}`);
      }
      ids.add(source.id);

      const domain = canonicalDomain(source.domain);
      const baseUrl = new URL(source.baseUrl);
      if (baseUrl.protocol !== 'https:') {
        throw new ConfigurationError(`Official source ${source.id} must use HTTPS`);
      }
      if (!domainMatches(baseUrl.hostname, domain, source.includeSubdomains)) {
        throw new ConfigurationError(
          `Official source ${source.id} baseUrl does not match its domain`,
        );
      }
      const pathPrefix =
        source.pathPrefix === undefined ? undefined : normalizePath(source.pathPrefix);
      if (pathPrefix !== undefined && !pathMatches(baseUrl.pathname, pathPrefix)) {
        throw new ConfigurationError(
          `Official source ${source.id} baseUrl does not match its pathPrefix`,
        );
      }

      const githubOrganizations = [
        ...new Set(source.githubOrganizations.map((organization) => organization.toLowerCase())),
      ].sort(compareText);

      return {
        id: source.id,
        name: source.name,
        domain,
        baseUrl: baseUrl.toString(),
        ...(pathPrefix === undefined ? {} : { pathPrefix }),
        includeSubdomains: source.includeSubdomains,
        githubOrganizations,
        keywords: source.keywords,
        priority: source.priority,
        enabled: source.enabled,
      };
    });
    this.fingerprint = createHash('sha256').update(JSON.stringify(this.sources)).digest('hex');
  }

  public findByUrl(value: string): OfficialSource | undefined {
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      return undefined;
    }
    return this.sources
      .filter((source) => source.enabled)
      .find(
        (source) =>
          (domainMatches(url.hostname, source.domain, source.includeSubdomains) &&
            (source.pathPrefix === undefined || pathMatches(url.pathname, source.pathPrefix))) ||
          githubOrganizationMatches(url, source.githubOrganizations),
      );
  }

  public findForQuery(query: string): readonly OfficialSource[] {
    const normalized = query.toLocaleLowerCase();
    return this.sources
      .filter((source) => source.enabled)
      .filter((source) =>
        source.keywords.some((keyword) => normalized.includes(keyword.toLocaleLowerCase())),
      )
      .sort((left, right) => right.priority - left.priority);
  }

  public list(): readonly OfficialSource[] {
    return this.sources;
  }

  public version(): string {
    return this.fingerprint;
  }
}

function canonicalDomain(value: string): string {
  const domain = value.trim().toLowerCase().replace(/\.$/, '');
  if (domain === '' || domain.includes('/') || domain.includes(':')) {
    throw new ConfigurationError(`Invalid official source domain: ${value}`);
  }
  return domain;
}

function domainMatches(hostname: string, domain: string, includeSubdomains: boolean): boolean {
  const normalized = hostname.toLowerCase().replace(/\.$/, '');
  return normalized === domain || (includeSubdomains && normalized.endsWith(`.${domain}`));
}

function normalizePath(value: string): string {
  const path = value.trim().replace(/\/+$/, '');
  return path === '' ? '/' : path;
}

function pathMatches(pathname: string, prefix: string): boolean {
  if (prefix === '/') return true;
  const normalized = pathname.replace(/\/+$/, '');
  return normalized === prefix || normalized.startsWith(`${prefix}/`);
}

function githubOrganizationMatches(url: URL, organizations: readonly string[]): boolean {
  const hostname = url.hostname.toLowerCase().replace(/\.$/u, '');
  if (hostname !== 'github.com' && hostname !== 'www.github.com') return false;
  const organization = url.pathname
    .split('/')
    .find((segment) => segment !== '')
    ?.toLowerCase();
  return organization !== undefined && organizations.includes(organization);
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
