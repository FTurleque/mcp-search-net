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

export class RequestTimeoutError extends ApplicationError {
  public constructor(message = 'The request timed out', options?: ErrorOptions) {
    super(message, 'REQUEST_TIMEOUT', options);
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

export class OcrRequiredError extends ApplicationError {
  public constructor(
    message = 'OCR is required and is not supported in V1',
    options?: ErrorOptions,
  ) {
    super(message, 'OCR_REQUIRED_NOT_SUPPORTED', options);
  }
}

export class CacheUnavailableError extends ApplicationError {
  public constructor(message = 'The cache is unavailable', options?: ErrorOptions) {
    super(message, 'CACHE_UNAVAILABLE', options);
  }
}
