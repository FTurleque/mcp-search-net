import type { ToolErrorCode } from '../models/tool-response.js';

export class ApplicationError extends Error {
  public constructor(
    message: string,
    public readonly code: ToolErrorCode | 'CONFIGURATION_ERROR',
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = new.target.name;
  }
}

export class ConfigurationError extends ApplicationError {
  public constructor(message: string, options?: ErrorOptions) {
    super(message, 'CONFIGURATION_ERROR', options);
  }
}

export class UrlSecurityError extends ApplicationError {
  public constructor(
    message: string,
    code: ToolErrorCode = 'BLOCKED_ADDRESS',
    options?: ErrorOptions,
  ) {
    super(message, code, options);
  }
}

export class ExternalServiceError extends ApplicationError {
  public constructor(
    message: string,
    public readonly service: 'searxng' | 'crawl4ai',
    options?: ErrorOptions,
  ) {
    super(
      message,
      service === 'searxng' ? 'SEARCH_PROVIDER_UNAVAILABLE' : 'CONTENT_PROVIDER_UNAVAILABLE',
      options,
    );
  }
}

export class InvalidArgumentError extends ApplicationError {
  public constructor(message = 'The tool arguments are invalid', options?: ErrorOptions) {
    super(message, 'INVALID_ARGUMENT', options);
  }
}

export class InvalidSearchQueryError extends InvalidArgumentError {
  public constructor(message = 'The search query is invalid', options?: ErrorOptions) {
    super(message, options);
  }
}

export class InvalidWebUrlError extends ApplicationError {
  public constructor(message = 'The Web URL is invalid', options?: ErrorOptions) {
    super(message, 'INVALID_URL', options);
  }
}

export class UnsupportedProtocolError extends ApplicationError {
  public constructor(
    message = 'Only HTTP and HTTPS protocols are supported',
    options?: ErrorOptions,
  ) {
    super(message, 'UNSUPPORTED_PROTOCOL', options);
  }
}

export class BlockedAddressError extends UrlSecurityError {
  public constructor(
    message = 'The address is blocked by the public URL policy',
    options?: ErrorOptions,
  ) {
    super(message, 'BLOCKED_ADDRESS', options);
  }
}

export class DnsResolutionError extends UrlSecurityError {
  public constructor(message = 'The hostname cannot be resolved safely', options?: ErrorOptions) {
    super(message, 'DNS_RESOLUTION_FAILED', options);
  }
}

export class InvalidDomainError extends InvalidArgumentError {
  public constructor(message = 'The domain name is invalid', options?: ErrorOptions) {
    super(message, options);
  }
}

export class ContextBudgetExceededError extends InvalidArgumentError {
  public constructor(
    message = 'The context budget is invalid or exceeded',
    options?: ErrorOptions,
  ) {
    super(message, options);
  }
}

export class RequestTimeoutError extends ApplicationError {
  public constructor(message = 'The request timed out', options?: ErrorOptions) {
    super(message, 'REQUEST_TIMEOUT', options);
  }
}

export class TooManyRedirectsError extends ApplicationError {
  public constructor(
    message = 'The maximum number of redirects was exceeded',
    options?: ErrorOptions,
  ) {
    super(message, 'TOO_MANY_REDIRECTS', options);
  }
}

export class ResponseTooLargeError extends ApplicationError {
  public constructor(message = 'The response exceeds the allowed size', options?: ErrorOptions) {
    super(message, 'RESPONSE_TOO_LARGE', options);
  }
}

export class HttpError extends ApplicationError {
  public constructor(
    message = 'The remote server returned an HTTP error',
    public readonly status?: number,
    options?: ErrorOptions,
  ) {
    super(message, 'HTTP_ERROR', options);
  }
}

export function isTransientHttpStatus(status: number): boolean {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

export class UnsupportedContentTypeError extends ApplicationError {
  public constructor(message = 'The content type is not supported', options?: ErrorOptions) {
    super(message, 'UNSUPPORTED_CONTENT_TYPE', options);
  }
}

export class ExtractionError extends ApplicationError {
  public constructor(message = 'The content could not be extracted', options?: ErrorOptions) {
    super(message, 'EXTRACTION_FAILED', options);
  }
}

export class NoRelevantContentError extends ApplicationError {
  public constructor(message = 'No relevant content was found', options?: ErrorOptions) {
    super(message, 'NO_RELEVANT_CONTENT', options);
  }
}

export class NoOfficialSourceFoundError extends NoRelevantContentError {
  public constructor(message = 'No verified official source was found', options?: ErrorOptions) {
    super(message, options);
  }
}

export class OcrRequiredError extends ApplicationError {
  public constructor(
    message = 'OCR is required and is not supported in V1',
    options?: ErrorOptions,
  ) {
    super(message, 'OCR_REQUIRED_NOT_SUPPORTED', options);
  }
}

export class OcrRequiredNotSupportedError extends OcrRequiredError {}

export class CacheUnavailableError extends ApplicationError {
  public constructor(message = 'The cache is unavailable', options?: ErrorOptions) {
    super(message, 'CACHE_UNAVAILABLE', options);
  }
}

export class SearchProviderUnavailableError extends ExternalServiceError {
  public constructor(
    message = 'The search provider is unavailable',
    public readonly status?: number,
    options?: ErrorOptions,
  ) {
    super(message, 'searxng', options);
  }
}

export class ContentProviderUnavailableError extends ExternalServiceError {
  public constructor(message = 'The content provider is unavailable', options?: ErrorOptions) {
    super(message, 'crawl4ai', options);
  }
}

export class InternalApplicationError extends ApplicationError {
  public constructor(message = 'An internal application error occurred', options?: ErrorOptions) {
    super(message, 'INTERNAL_ERROR', options);
  }
}
