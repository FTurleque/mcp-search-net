import {
  ExternalServiceError,
  HttpError,
  RequestTimeoutError,
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
      throw new ExternalServiceError(`${service} returned invalid JSON`, service, { cause: error });
    }
  } catch (error) {
    if (error instanceof ExternalServiceError || error instanceof HttpError) throw error;
    if (error instanceof Error && error.name === 'AbortError') {
      throw new RequestTimeoutError(`${service} request timed out`, { cause: error });
    }
    throw new ExternalServiceError(`${service} request failed`, service, { cause: error });
  } finally {
    clearTimeout(timeout);
  }
}
