export class ApplicationError extends Error {
  public constructor(
    message: string,
    public readonly code: string,
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
  public constructor(message: string, options?: ErrorOptions) {
    super(message, 'URL_NOT_ALLOWED', options);
  }
}

export class ExternalServiceError extends ApplicationError {
  public constructor(
    message: string,
    public readonly service: 'searxng' | 'crawl4ai',
    options?: ErrorOptions,
  ) {
    super(message, 'EXTERNAL_SERVICE_ERROR', options);
  }
}
