import {
  ExternalServiceError,
  ContentProviderUnavailableError,
  HttpError,
  RequestTimeoutError,
  SearchProviderUnavailableError,
} from '../../domain/errors/domain-errors.js';

const DEFAULT_MAX_PROVIDER_JSON_BYTES = 16 * 1024 * 1024;

export async function fetchJson(
  service: 'searxng' | 'crawl4ai',
  url: URL,
  init: RequestInit,
  timeoutMs: number,
  fetchImplementation: typeof fetch,
  maxResponseBytes = DEFAULT_MAX_PROVIDER_JSON_BYTES,
): Promise<unknown> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  timeout.unref();

  try {
    const response = await fetchImplementation(url, {
      ...init,
      redirect: 'error',
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new HttpError(`${service} returned HTTP ${response.status}`, response.status);
    }
    return await readJsonWithLimit(service, response, maxResponseBytes);
  } catch (error) {
    if (error instanceof ExternalServiceError || error instanceof HttpError) throw error;
    if (error instanceof Error && error.name === 'AbortError') {
      throw new RequestTimeoutError(`${service} request timed out`, { cause: error });
    }
    throw providerUnavailable(service, `${service} request failed`, error);
  } finally {
    clearTimeout(timeout);
  }
}

async function readJsonWithLimit(
  service: 'searxng' | 'crawl4ai',
  response: Response,
  maximumBytes: number,
): Promise<unknown> {
  if (!Number.isSafeInteger(maximumBytes) || maximumBytes <= 0) {
    throw providerUnavailable(service, `${service} has an invalid JSON response budget`, undefined);
  }

  const declared = Number.parseInt(response.headers.get('content-length') ?? '0', 10);
  if (Number.isFinite(declared) && declared > maximumBytes) {
    throw providerUnavailable(
      service,
      `${service} JSON response exceeds ${maximumBytes} bytes`,
      undefined,
    );
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maximumBytes) {
      await reader.cancel();
      throw providerUnavailable(
        service,
        `${service} JSON response exceeds ${maximumBytes} bytes`,
        undefined,
      );
    }
    chunks.push(value);
  }

  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }

  try {
    return JSON.parse(new TextDecoder().decode(body));
  } catch (error) {
    throw providerUnavailable(service, `${service} returned invalid JSON`, error);
  }
}

function providerUnavailable(
  service: 'searxng' | 'crawl4ai',
  message: string,
  cause: unknown,
): ExternalServiceError {
  return service === 'searxng'
    ? new SearchProviderUnavailableError(message, { cause })
    : new ContentProviderUnavailableError(message, { cause });
}
