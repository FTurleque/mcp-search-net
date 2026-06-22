import {
  ExternalServiceError,
  ContentProviderUnavailableError,
  HttpError,
  RequestTimeoutError,
  SearchProviderUnavailableError,
} from '../../domain/errors/domain-errors.js';

export async function fetchJson(
  service: 'searxng' | 'crawl4ai',
  url: URL,
  init: RequestInit,
  timeoutMs: number,
  fetchImplementation: typeof fetch,
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
    try {
      return await response.json();
    } catch (error) {
      throw providerUnavailable(service, `${service} returned invalid JSON`, error);
    }
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

function providerUnavailable(
  service: 'searxng' | 'crawl4ai',
  message: string,
  cause: unknown,
): ExternalServiceError {
  return service === 'searxng'
    ? new SearchProviderUnavailableError(message, { cause })
    : new ContentProviderUnavailableError(message, { cause });
}
