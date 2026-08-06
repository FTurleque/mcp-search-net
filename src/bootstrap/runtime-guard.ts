import { ConfigurationError } from '../domain/errors/domain-errors.js';

export function assertSupportedNodeVersion(version: string): void {
  const major = Number.parseInt(version.split('.')[0] ?? '0', 10);
  if (major !== 24) {
    throw new ConfigurationError(`Node.js 24 LTS is required; current runtime is ${version}`);
  }
}
