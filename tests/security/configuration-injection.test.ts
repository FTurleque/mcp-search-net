import { describe, expect, it } from 'vitest';

import { applicationConfigSchema } from '../../src/infrastructure/config/application-config.js';
import { createFetchUrlSchemas } from '../../src/presentation/mcp/schemas/fetch-url-schema.js';
import { isInvalidToolInput } from '../../src/presentation/mcp/schemas/invalid-tool-input.js';

describe('executable configuration rejection', () => {
  it.each(['customJavaScript', 'hooks', 'cookies', 'proxy', 'file', 'authentication'])(
    'rejects caller field %s',
    (field) => {
      const schemas = createFetchUrlSchemas(12_000, 30_000, 5, 10);
      const parsed = schemas.input.parse({
        url: 'https://example.com',
        [field]: field === 'hooks' ? [] : 'hostile-value',
      });
      expect(isInvalidToolInput(parsed)).toBe(true);
    },
  );

  it('rejects executable YAML keys and absolute-limit overrides', () => {
    expect(
      applicationConfigSchema.safeParse({
        crawl4ai: { customJavaScript: 'process.exit()' },
      }).success,
    ).toBe(false);
    expect(applicationConfigSchema.safeParse({ limits: { maxFetchChars: 250_000 } }).success).toBe(
      false,
    );
  });
});
