import { describe, expect, it } from 'vitest';

import { ConfigurationError } from '../../src/domain/errors/domain-errors.js';
import { assertSupportedNodeVersion } from '../../src/bootstrap/runtime-guard.js';

describe('bootstrap runtime guard', () => {
  it.each(['24.0.0', '24.18.0', '24.99.1'])('accepts Node 24 runtime %s', (version) => {
    expect(() => assertSupportedNodeVersion(version)).not.toThrow();
  });

  it.each(['0.0.0', '22.20.0', '25.0.0', 'invalid'])(
    'rejects unsupported runtime %s without starting providers',
    (version) => {
      expect(() => assertSupportedNodeVersion(version)).toThrow(ConfigurationError);
    },
  );
});
