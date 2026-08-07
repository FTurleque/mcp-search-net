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

const DEFAULT_MAX_TRACKED_ORIGINS = 1_024;

export interface SecureHttpGatewayOptions {
  readonly timeoutMs: number;
  readonly maxBytes: number;
  readonly maxRedirects: number;
  readonly maxConcurrency: number;
  readonly minimumDelayMs: number;
  readonly respectRobotsTxt: boolean;
  readonly userAgent: string;
  readonly maxTrackedOrigins?: number;
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

interface DownloadBudget {
  remainingBytes: number;
}

interface RobotsRule {
  readonly allowed: boolean;
  readonly pattern: string;
}

interface RobotsGroup {
  readonly agents: readonly string[];
  readonly rules: readonly RobotsRule[];
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
  private readonly maxTrackedOrigins: number;

  public constructor(
    private readonly securityPolicy: UrlSecurityPolicy,
    private readonly options: SecureHttpGatewayOptions,
  ) {
    const maxTrackedOrigins = options.maxTrackedOrigins ?? DEFAULT_MAX_TRACKED_ORIGINS;
    if (!Number.isInteger(maxTrackedOrigins) || maxTrackedOrigins <= 0) {
      throw new ApplicationError('maxTrackedOrigins must be a positive integer', 'INTERNAL_ERROR');
    }
    this.maxTrackedOrigins = maxTrackedOrigins;
  }

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
      return await this.follow(
        value,
        value,
        0,
        deadline,
        conditionalHeaders,
        context,
        limits,
        [],
        { remainingBytes: limits.maxBytes },
      );
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
    budget: DownloadBudget,
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
      budget,
    );
    if (isRedirectStatus(response.status)) {
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
        budget,
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
      resource = await this.follow(
        robotsUrl,
        robotsUrl,
        0,
        deadline,
        {},
        context,
        limits,
        [],
        { remainingBytes: limits.maxBytes },
      );
    } catch (error) {
      if (error instanceof HttpError && error.status === 404) return;
      // A temporarily unavailable robots file does not grant access silently.
      throw error;
    }
    const rules = new TextDecoder().decode(resource.body);
    const path = `${url.pathname || '/'}${url.search}`;
    if (!isAllowedByRobots(rules, path, this.options.userAgent)) {
      throw new UrlSecurityError('robots.txt disallows fetching this URL', 'BLOCKED_ADDRESS');
    }
  }

  private async requestPinned(
    approved: Awaited<ReturnType<UrlSecurityPolicy['assertAllowed']>>,
    deadline: number,
    conditionalHeaders: Readonly<Record<string, string>>,
    budget: DownloadBudget,
  ): Promise<PinnedResponse> {
    if (approved.addresses.length === 0) {
      throw new UrlSecurityError('No approved address is available');
    }

    let lastConnectionError: HttpError | undefined;
    for (const address of approved.addresses) {
      try {
        return await this.requestPinnedAtAddress(
          approved.value,
          address,
          deadline,
          conditionalHeaders,
          budget,
        );
      } catch (error) {
        if (!isRetryablePinnedConnectionError(error)) throw error;
        lastConnectionError = error;
        if (Date.now() >= deadline) throw new RequestTimeoutError();
      }
    }

    throw (
      lastConnectionError ?? new HttpError('Secure HTTP request failed for every approved address')
    );
  }

  private requestPinnedAtAddress(
    approvedUrl: string,
    address: string,
    deadline: number,
    conditionalHeaders: Readonly<Record<string, string>>,
    budget: DownloadBudget,
  ): Promise<PinnedResponse> {
    const url = new URL(approvedUrl);
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
      let settled = false;
      let absoluteTimer: NodeJS.Timeout | undefined;

      const settleResolve = (response: PinnedResponse): void => {
        if (settled) return;
        settled = true;
        if (absoluteTimer !== undefined) clearTimeout(absoluteTimer);
        resolve(response);
      };
      const settleReject = (error: unknown): void => {
        if (settled) return;
        settled = true;
        if (absoluteTimer !== undefined) clearTimeout(absoluteTimer);
        reject(toPinnedRequestError(error));
      };

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

          // Redirect and 304 bodies are irrelevant to the contract. Abort them immediately so a
          // hostile endpoint cannot spend the byte budget before the next validated hop.
          if (isRedirectStatus(status) || status === 304) {
            incoming.destroy();
            settleResolve({ status, headers, body: new Uint8Array() });
            return;
          }

          const declared = Number.parseInt(headers['content-length'] ?? '0', 10);
          if (Number.isFinite(declared) && declared > budget.remainingBytes) {
            incoming.destroy();
            settleReject(new ResponseTooLargeError());
            return;
          }

          const chunks: Buffer[] = [];
          incoming.on('data', (chunk: Buffer) => {
            if (chunk.length > budget.remainingBytes) {
              incoming.destroy();
              settleReject(new ResponseTooLargeError());
              return;
            }
            budget.remainingBytes -= chunk.length;
            chunks.push(chunk);
          });
          incoming.on('end', () => settleResolve({ status, headers, body: Buffer.concat(chunks) }));
          incoming.on('aborted', () =>
            settleReject(new HttpError('Secure HTTP response was aborted before completion')),
          );
          incoming.on('error', (error) => settleReject(error));
        },
      );

      // ClientRequest.setTimeout is an inactivity timeout. This independent timer is the actual
      // wall-clock deadline and therefore also stops slow-drip responses that keep the socket busy.
      absoluteTimer = setTimeout(() => {
        settleReject(new RequestTimeoutError());
        outgoing.destroy();
      }, remaining);
      absoluteTimer.unref();

      outgoing.on('error', (error) => settleReject(error));
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
    this.rememberOriginRequest(origin, Date.now());
  }

  private rememberOriginRequest(origin: string, timestamp: number): void {
    this.lastRequestByOrigin.delete(origin);
    this.lastRequestByOrigin.set(origin, timestamp);
    while (this.lastRequestByOrigin.size > this.maxTrackedOrigins) {
      const oldestOrigin = this.lastRequestByOrigin.keys().next().value;
      if (oldestOrigin === undefined) break;
      this.lastRequestByOrigin.delete(oldestOrigin);
    }
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

function toPinnedRequestError(error: unknown): ApplicationError {
  return error instanceof ApplicationError
    ? error
    : new HttpError('Secure HTTP request failed', undefined, { cause: error });
}

function isRetryablePinnedConnectionError(error: unknown): error is HttpError {
  return error instanceof HttpError && error.status === undefined;
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

function isRedirectStatus(status: number): boolean {
  return status >= 300 && status < 400 && status !== 304;
}

function isPermanentRedirect(status: number): boolean {
  return status === 301 || status === 308;
}

function isAllowedByRobots(content: string, path: string, userAgent: string): boolean {
  const groups = parseRobotsGroups(content);
  const productToken = userAgent.toLowerCase().split('/')[0]?.trim() ?? userAgent.toLowerCase();
  const specificGroups = groups.filter((group) => group.agents.includes(productToken));
  const applicableGroups =
    specificGroups.length > 0
      ? specificGroups
      : groups.filter((group) => group.agents.includes('*'));

  let best: { allowed: boolean; length: number } | undefined;
  for (const group of applicableGroups) {
    for (const rule of group.rules) {
      if (rule.pattern === '' || !robotsRuleMatches(rule.pattern, path)) continue;
      const specificity = robotsRuleSpecificity(rule.pattern);
      if (
        best === undefined ||
        specificity > best.length ||
        (specificity === best.length && rule.allowed && !best.allowed)
      ) {
        best = { allowed: rule.allowed, length: specificity };
      }
    }
  }
  return best?.allowed ?? true;
}

interface RobotsDirective {
  readonly field: string;
  readonly value: string;
}

interface NormalizedPercentOctet {
  readonly value: string;
  readonly nextIndex: number;
}

function parseRobotsGroups(content: string): readonly RobotsGroup[] {
  const groups: RobotsGroup[] = [];
  let agents: string[] = [];
  let rules: RobotsRule[] = [];

  const flush = (): void => {
    if (agents.length > 0) groups.push({ agents: [...agents], rules: [...rules] });
    agents = [];
    rules = [];
  };

  for (const rawLine of content.replaceAll('\r', '').split('\n')) {
    const directive = parseRobotsDirective(rawLine);
    if (directive === undefined) continue;
    if (directive.field === 'user-agent') {
      if (rules.length > 0) flush();
      if (directive.value !== '') agents.push(directive.value.toLowerCase());
      continue;
    }
    const allowed = robotsRuleAllowed(directive.field);
    if (allowed !== undefined && agents.length > 0) {
      rules.push({ allowed, pattern: directive.value });
    }
  }

  flush();
  return groups;
}

function parseRobotsDirective(rawLine: string): RobotsDirective | undefined {
  const commentIndex = rawLine.indexOf('#');
  const line = (commentIndex >= 0 ? rawLine.slice(0, commentIndex) : rawLine).trim();
  if (line === '') return undefined;
  const separator = line.indexOf(':');
  if (separator < 0) return undefined;
  return {
    field: line.slice(0, separator).trim().toLowerCase(),
    value: line.slice(separator + 1).trim(),
  };
}

function robotsRuleAllowed(field: string): boolean | undefined {
  if (field === 'allow') return true;
  if (field === 'disallow') return false;
  return undefined;
}

function robotsRuleMatches(rule: string, path: string): boolean {
  const anchored = rule.endsWith('$');
  const withoutAnchor = anchored ? rule.slice(0, -1) : rule;
  const normalizedPattern = normalizeRobotsOctets(withoutAnchor, true);
  const normalizedPath = normalizeRobotsOctets(path, false);
  return robotsWildcardMatches(normalizedPattern, normalizedPath, anchored);
}

function robotsWildcardMatches(pattern: string, path: string, anchored: boolean): boolean {
  const segments = pattern.split('*');
  let segmentIndex = 0;
  let cursor = 0;

  if (!pattern.startsWith('*')) {
    const firstSegment = segments[0] ?? '';
    if (!path.startsWith(firstSegment)) return false;
    cursor = firstSegment.length;
    segmentIndex = 1;
  }

  for (; segmentIndex < segments.length; segmentIndex += 1) {
    const segment = segments[segmentIndex] ?? '';
    if (segment === '') continue;
    const found = path.indexOf(segment, cursor);
    if (found < 0) return false;
    cursor = found + segment.length;
  }

  return !anchored || pattern.endsWith('*') || cursor === path.length;
}

function robotsRuleSpecificity(rule: string): number {
  const anchored = rule.endsWith('$');
  const withoutAnchor = anchored ? rule.slice(0, -1) : rule;
  return normalizeRobotsOctets(withoutAnchor, true)
    .replaceAll('*', '')
    .replace(/%[0-9A-F]{2}/gu, 'x').length;
}

function normalizeRobotsOctets(value: string, preserveWildcards: boolean): string {
  let result = '';
  for (let index = 0; index < value.length; ) {
    const encoded = normalizePercentOctet(value, index);
    if (encoded !== undefined) {
      result += encoded.value;
      index = encoded.nextIndex;
      continue;
    }

    const codePoint = value.codePointAt(index);
    if (codePoint === undefined) return result;
    const character = String.fromCodePoint(codePoint);
    result += normalizeRobotsCharacter(character, codePoint, preserveWildcards);
    index += character.length;
  }
  return result;
}

function normalizePercentOctet(value: string, index: number): NormalizedPercentOctet | undefined {
  if (value[index] !== '%') return undefined;
  const hex = value.slice(index + 1, index + 3);
  if (!/^[0-9A-Fa-f]{2}$/u.test(hex)) return undefined;
  const normalizedHex = hex.toUpperCase();
  const decoded = String.fromCodePoint(Number.parseInt(normalizedHex, 16));
  return {
    value: isUnreservedAscii(decoded) ? decoded : `%${normalizedHex}`,
    nextIndex: index + 3,
  };
}

function normalizeRobotsCharacter(
  character: string,
  codePoint: number,
  preserveWildcards: boolean,
): string {
  if (preserveWildcards && character === '*') return character;
  if (codePoint <= 0x7f) return character;
  return Array.from(
    new TextEncoder().encode(character),
    (byte) => `%${byte.toString(16).toUpperCase().padStart(2, '0')}`,
  ).join('');
}

function isUnreservedAscii(value: string): boolean {
  return /^[A-Za-z0-9._~-]$/u.test(value);
}
