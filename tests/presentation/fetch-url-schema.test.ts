import { describe, expect, it } from 'vitest';

import { createFetchUrlSchemas } from '../../src/presentation/mcp/schemas/fetch-url-schema.js';
import { isInvalidToolInput } from '../../src/presentation/mcp/schemas/invalid-tool-input.js';

describe('fetch_url input schema', () => {
  const schemas = createFetchUrlSchemas(12_000, 30_000, 5, 10);

  it('applies the V1 defaults', () => {
    expect(schemas.input.parse({ url: 'https://example.com/docs' })).toEqual({
      url: 'https://example.com/docs',
      maxCharacters: 12_000,
      maxSections: 5,
      renderMode: 'static',
    });
  });

  it('accepts the bounded auto mode contract', () => {
    expect(
      schemas.input.parse({
        url: 'https://example.com/docs',
        query: 'security redirects',
        maxCharacters: 30_000,
        maxSections: 10,
        renderMode: 'auto',
      }),
    ).toMatchObject({ renderMode: 'auto', maxSections: 10 });
  });

  it('rejects the former field and values above the absolute section limit', () => {
    expect(
      isInvalidToolInput(schemas.input.parse({ url: 'https://example.com', maxChars: 4_000 })),
    ).toBe(true);
    expect(
      isInvalidToolInput(schemas.input.parse({ url: 'https://example.com', maxSections: 11 })),
    ).toBe(true);
  });
});
