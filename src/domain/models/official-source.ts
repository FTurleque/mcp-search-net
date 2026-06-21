export interface OfficialSource {
  readonly id: string;
  readonly name: string;
  readonly domain: string;
  readonly baseUrl: string;
  readonly pathPrefix?: string;
  readonly includeSubdomains: boolean;
  readonly githubOrganizations: readonly string[];
  readonly keywords: readonly string[];
  readonly priority: number;
  readonly enabled: boolean;
}
