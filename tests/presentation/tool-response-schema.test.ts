import { describe, expect, it } from 'vitest';
import { z } from 'zod/v4';

import {
  EXTERNAL_CONTENT_SAFETY_NOTICE,
  EXTERNAL_CONTENT_TRUST,
  TOOL_ERROR_CODES,
  TOOL_WARNING_CODES,
} from '../../src/domain/models/tool-response.js';
import { createSearchWebSchemas } from '../../src/presentation/mcp/schemas/search-web-schema.js';
import { isInvalidToolInput } from '../../src/presentation/mcp/schemas/invalid-tool-input.js';
import {
  toolErrorResponseSchema,
  toolWarningSchema,
} from '../../src/presentation/mcp/schemas/tool-response-schema.js';

const requestId = '00000000-0000-4000-8000-000000000001';

describe('tool response schemas', () => {
  it('keeps the advertised input contract while recovering invalid input for stable mapping', () => {
    const schemas = createSearchWebSchemas(5, 10);
    const jsonSchema = z.toJSONSchema(schemas.input);

    expect(jsonSchema).toMatchObject({
      type: 'object',
      properties: { query: { type: 'string', minLength: 2 } },
      additionalProperties: false,
    });
    expect(isInvalidToolInput(schemas.input.parse({ query: 42 }))).toBe(true);
    expect(isInvalidToolInput(schemas.input.parse({ query: 'mcp\nsearch' }))).toBe(true);
    expect(schemas.input.parse({ query: 'mcp' })).toMatchObject({
      query: 'mcp',
      sourcePolicy: 'prefer',
      allowedDomains: [],
      excludedDomains: [],
      language: 'fr-FR',
      maxResults: 5,
    });
  });

  it('accepts the common versioned success envelope and rejects an invalid cache status', () => {
    const schema = createSearchWebSchemas(5, 10).output;
    const response = {
      schemaVersion: '1.0',
      requestId,
      status: 'success',
      warnings: [],
      metadata: {
        tool: 'search_web',
        durationMs: 1.25,
        cacheStatus: 'MISS',
        provider: 'searxng',
        contentTrust: EXTERNAL_CONTENT_TRUST,
        contentSafetyNotice: EXTERNAL_CONTENT_SAFETY_NOTICE,
      },
      data: {
        query: 'mcp',
        results: [],
        metadata: {
          total: 0,
          returned: 0,
          unresponsiveEngines: [],
          sourceProvider: 'searxng',
          retrievedAt: '2026-07-29T12:00:00.000Z',
        },
      },
    };

    expect(schema.safeParse(response).success).toBe(true);
    expect(
      schema.safeParse({
        ...response,
        metadata: { ...response.metadata, cacheStatus: 'CACHED' },
      }).success,
    ).toBe(false);
  });

  it('accepts every stable warning and error code', () => {
    for (const code of TOOL_WARNING_CODES) {
      expect(toolWarningSchema.safeParse({ code, message: code, requestId }).success).toBe(true);
    }
    for (const code of TOOL_ERROR_CODES) {
      expect(
        toolErrorResponseSchema.safeParse({
          schemaVersion: '1.0',
          requestId,
          code,
          message: code,
          retryable: false,
        }).success,
      ).toBe(true);
    }
  });
});
