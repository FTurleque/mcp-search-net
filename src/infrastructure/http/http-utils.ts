import { ExternalServiceError } from '../../domain/errors/domain-errors.js';

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
      const details = await response.text().catch(() => '');
      throw new ExternalServiceError(
        `${service} returned HTTP ${response.status}${details === '' ? '' : `: ${truncate(details, 500)}`}`,
        service,
      );
    }
    try {
      return await response.json();
    } catch (error) {
      throw new ExternalServiceError(`${service} returned invalid JSON`, service, { cause: error });
    }
  } catch (error) {
    if (error instanceof ExternalServiceError) throw error;
    const message =
      error instanceof Error && error.name === 'AbortError'
        ? 'request timed out'
        : 'request failed';
    throw new ExternalServiceError(`${service} ${message}`, service, { cause: error });
  } finally {
    clearTimeout(timeout);
  }
}

function truncate(value: string, maxLength: number): string {
  return value.length <= maxLength ? value : `${value.slice(0, maxLength)}…`;
}
