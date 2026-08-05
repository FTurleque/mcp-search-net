import { request as requestHttp } from 'node:http';
import type { IncomingHttpHeaders } from 'node:http';
import { request as requestHttps } from 'node:https';
import { isIP } from 'node:net';
import type { LookupFunction } from 'node:net';

import type { UrlSecurityPolicy } from '../../application/ports/url-security-policy.js';
import {
  ApplicationError,
  HttpError,
  RequestTimeoutError,
  ResponseTooLargeError,
  TooManyRedirectsError,
  UrlSecurityError,
} from '../../domain/errors/domain-errors.js';

export interface SecureHttpGatewayOptions {
  readonly timeoutMs: number;
  readonly maxBytes: number;
  readonly maxRedirects: number;
  readonly maxConcurrency: number;
  readonly minimumDelayMs: number;
  readonly respectRobotsTxt: boolean;
  readonly userAgent: string;
}

export interface DownloadRedirect {
  readonly fromUrl: string;
  readonly toUrl: string;
  readonly status: number;
  readonly permanent: boolean;
}

export interface DownloadedResource {
  readonly requestedUrl: string;
  readonly finalUrl: string;
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: Uint8Array;
  readonly redirectChain?: readonly DownloadRedirect[];
}

interface PinnedResponse {
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: Uint8Array;
}

export interface SecureDownloadLimits {
  readonly timeoutMs: number;
  readonly maxBytes: number;
  readonly maxRedirects: number;
}

export class SecureHttpGateway {
  private active = 0;
  private readonly waiters: (() => void)[] = [];
  private readonly lastRequestByOrigin = new Map<string, number>();

  public constructor(
    private readonly securityPolicy: UrlSecurityPolicy,
    private readonly options: SecureHttpGatewayOptions,
  ) {}

  public async download(
    value: string,
    conditionalHeaders: Readonly<Record<string, string>> = {},
    context: { readonly requestId?: string; readonly tool?: 'fetch_url' } = {},
    requestedLimits?: SecureDownloadLimits,
  ): Promise<DownloadedResource> {
    const limits = this.validateLimits(requestedLimits);
    const deadline = Date.now() + limits.timeoutMs;
    await this.acquire(deadline);
    try {
      if (this.options.respectRobotsTxt && !new URL(value).pathname.endsWith('/robots.txt')) {
        await this.assertRobotsAllowed(value, deadline, context, limits);
      }
      return await this.follow(value, value, 0, deadline, conditionalHeaders, context, limits, []);
    } finally {
      this.release();
    }
  }

  private async follow(
    requestedUrl: string,
    currentUrl: string,
    redirects: number,
    deadline: number,
    conditionalHeaders: Readonly<Record<string, string>>,
    context: { readonly requestId?: string; readonly tool?: 'fetch_url' },
    limits: SecureDownloadLimits,
    redirectChain: readonly DownloadRedirect[],
  ): Promise<DownloadedResource> {
    if (redirects > limits.maxRedirects) throw new TooManyRedirectsError();
    const approved = await withDeadline(
      this.securityPolicy.assertAllowed(currentUrl, context),
      deadline,
    );
    await this.throttle(new URL(approved.value).origin, deadline);
    const sameOrigin = new URL(approved.value).origin === new URL(requestedUrl).origin;
    const response = await this.requestPinned(
      approved,
      deadline,
      sameOrigin ? conditionalHeaders : {},
      limits.maxBytes,
    );
    if (response.status >= 300 && response.status < 400 && response.status !== 304) {
      const location = response.headers['location'];
      if (location === undefined)
        throw new HttpError('Redirect response has no Location header', response.status);
      const target = new URL(location, approved.value).toString();
      const redirect: DownloadRedirect = {
        fromUrl: approved.value,
        toUrl: target,
        status: response.status,
        permanent: isPermanentRedirect(response.status),
      };
      // The next URL is validated at the start of follow, before any connection is opened.
      return this.follow(
        requestedUrl,
        target,
        redirects + 1,
        deadline,
        conditionalHeaders,
        context,
        limits,
        [...redirectChain, redirect],
      );
    }
    if (response.status !== 304 && (response.status < 200 || response.status >= 300)) {
      throw new HttpError(`Remote server returned HTTP ${response.status}`, response.status);
    }
    return { requestedUrl, finalUrl: approved.value, redirectChain, ...response };
  }

  private async assertRobotsAllowed(
    value: string,
    deadline: number,
    context: { readonly requestId?: string; readonly tool?: 'fetch_url' },
    limits: SecureDownloadLimits,
  ): Promise<void> {
    const url = new URL(value);
    const robotsUrl = new URL('/robots.txt', url.origin).toString();
    let resource: DownloadedResource;
    try {
      resource = await this.follow(robotsUrl, robotsUrl, 0, deadline, {}, context, limits, []);
    } catch (error) {
      if (error instanceof HttpError && error.status === 404) return;
      // A temporarily unavailable robots file does not grant access silently.
      throw error;
    }
    const rules = new TextDecoder().decode(resource.body);
    if (!isAllowedByRobots(rules, url.pathname || '/', this.options.userAgent)) {
      throw new UrlSecurityError('robots.txt disallows fetching this URL', 'BLOCKED_ADDRESS');
    }
  }

  private requestPinned(
    approved: Awaited<ReturnType<UrlSecurityPolicy['assertAllowed']>>,
    deadline: number,
    conditionalHeaders: Readonly<Record<string, string>>,
    maxBytes: number,
  ): Promise<PinnedResponse> {
    const url = new URL(approved.value);
    const address = approved.addresses[0];
    if (address === undefined) throw new UrlSecurityError('No approved address is available');
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new RequestTimeoutError();
    const request = url.protocol === 'https:' ? requestHttps : requestHttp;
    const family = isIP(address) as 4 | 6;
    const lookup = ((
      _hostname: string,
      options: { all?: boolean },
      callback: (...arguments_: unknown[]) => void,
    ) => {
      if (options.all === true) callback(null, [{ address, family }]);
      else callback(null, address, family);
    }) as unknown as LookupFunction;

    return new Promise((resolve, reject) => {
      const outgoing = request(
        url,
        {
          method: 'GET',
          headers: {
            accept:
              'text/html,text/plain,text/markdown,application/json,application/xml,application/pdf;q=0.9,*/*;q=0.1',
            'accept-encoding': 'identity',
            'user-agent': this.options.userAgent,
            ...conditionalHeaders,
          },
          lookup,
          ...(url.protocol === 'https:' ? { servername: url.hostname } : {}),
        },
        (incoming) => {
          const status = incoming.statusCode ?? 0;
          const headers = flattenHeaders(incoming.headers);
          const declared = Number.parseInt(headers['content-length'] ?? '0', 10);
          if (Number.isFinite(declared) && declared > maxBytes) {
            incoming.destroy();
            reject(new ResponseTooLargeError());
            return;
          }
          const chunks: Buffer[] = [];
          let size = 0;
          incoming.on('data', (chunk: Buffer) => {
            size += chunk.length;
            if (size > maxBytes) {
              incoming.destroy(new ResponseTooLargeError());
              return;
            }
            chunks.push(chunk);
          });
          incoming.on('end', () => resolve({ status, headers, body: Buffer.concat(chunks) }));
          incoming.on('error', reject);
        },
      );
      outgoing.setTimeout(remaining, () => outgoing.destroy(new RequestTimeoutError()));
      outgoing.on('error', (error) =>
        reject(
          error instanceof ApplicationError
            ? error
            : new HttpError('Secure HTTP request failed', undefined, { cause: error }),
        ),
      );
      outgoing.end();
    });
  }

  private validateLimits(requested?: SecureDownloadLimits): SecureDownloadLimits {
    const limits = requested ?? {
      timeoutMs: this.options.timeoutMs,
      maxBytes: this.options.maxBytes,
      maxRedirects: this.options.maxRedirects,
    };
    if (
      limits.timeoutMs <= 0 ||
      limits.maxBytes <= 0 ||
      limits.maxRedirects < 0 ||
      limits.timeoutMs > this.options.timeoutMs ||
      limits.maxBytes > this.options.maxBytes ||
      limits.maxRedirects > this.options.maxRedirects
    ) {
      throw new ApplicationError('Unsafe HTTP limits were requested', 'INTERNAL_ERROR');
    }
    return limits;
  }

  private async throttle(origin: string, deadline: number): Promise<void> {
    const wait = Math.max(
      0,
      (this.lastRequestByOrigin.get(origin) ?? 0) + this.options.minimumDelayMs - Date.now(),
    );
    if (Date.now() + wait >= deadline) throw new RequestTimeoutError();
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
    this.lastRequestByOrigin.set(origin, Date.now());
  }

  private async acquire(deadline: number): Promise<void> {
    if (this.active < this.options.maxConcurrency) {
      this.active += 1;
      return;
    }
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new RequestTimeoutError();
    await new Promise<void>((resolve, reject) => {
      const waiter = (): void => {
        clearTimeout(timer);
        resolve();
      };
      const timer = setTimeout(() => {
        const index = this.waiters.indexOf(waiter);
        if (index >= 0) this.waiters.splice(index, 1);
        reject(new RequestTimeoutError());
      }, remaining);
      timer.unref();
      this.waiters.push(waiter);
    });
    this.active += 1;
  }

  private release(): void {
    this.active -= 1;
    this.waiters.shift()?.();
  }
}

async function withDeadline<T>(operation: Promise<T>, deadline: number): Promise<T> {
  const remaining = deadline - Date.now();
  if (remaining <= 0) throw new RequestTimeoutError();

  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new RequestTimeoutError()), remaining);
    timer.unref();
  });

  try {
    return await Promise.race([operation, timeout]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

function flattenHeaders(headers: IncomingHttpHeaders): Record<string, string> {
  return Object.fromEntries(
    Object.entries(headers).flatMap(([key, value]) =>
      value === undefined
        ? []
        : [[key.toLowerCase(), Array.isArray(value) ? value.join(', ') : value]],
    ),
  );
}

function isPermanentRedirect(status: number): boolean {
  return status === 301 || status === 308;
}

function isAllowedByRobots(content: string, path: string, userAgent: string): boolean {
  const groups = content.replace(/\r/gu, '').split(/\n\s*\n/gu);
  const agent = userAgent.toLowerCase().split('/')[0] ?? userAgent.toLowerCase();
  const rules = groups.filter((group) => {
    const agents = [...group.matchAll(/^\s*user-agent\s*:\s*(.+)$/gimu)].map((match) =>
      match[1]?.trim().toLowerCase(),
    );
    return agents.includes('*') || agents.includes(agent);
  });
  let best: { allowed: boolean; length: number } | undefined;
  for (const group of rules) {
    for (const match of group.matchAll(/^\s*(allow|disallow)\s*:\s*(.*)$/gimu)) {
      const rule = match[2]?.trim() ?? '';
      if (rule === '' || !robotsRuleMatches(rule, path)) continue;
      const allowed = match[1]?.toLowerCase() === 'allow';
      const specificity = robotsRuleSpecificity(rule);
      if (
        best === undefined ||
        specificity > best.length ||
        (specificity === best.length && allowed && !best.allowed)
      ) {
        best = { allowed, length: specificity };
      }
    }
  }
  return best?.allowed ?? true;
}

function robotsRuleMatches(rule: string, path: string): boolean {
  const anchored = rule.endsWith('$');
  const withoutAnchor = anchored ? rule.slice(0, -1) : rule;
  const pattern = withoutAnchor
    .replace(/[.+?^${}()|[\]\\]/gu, '\\$&')
    .replace(/\*/gu, '.*');
  return new RegExp(`^${pattern}${anchored ? '$' : ''}`, 'u').test(path);
}

function robotsRuleSpecificity(rule: string): number {
  return rule.replace(/\*/gu, '').replace(/\$$/u, '').length;
}
