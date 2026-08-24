import { describe, expect, it } from 'vitest';

import {
  EXTERNAL_CONTENT_SAFETY_NOTICE,
  EXTERNAL_CONTENT_TRUST,
} from '../../src/domain/models/tool-response.js';
import { StructuredLogger } from '../../src/infrastructure/logging/structured-logger.js';
import { executeToolCall } from '../../src/presentation/mcp/tool-call.js';

describe('read_doc_section text fallback correlation', () => {
  it('exposes the real requestId to clients that only consume text content', async () => {
    const requestId = '11111111-2222-4333-8444-555555555555';
    const result = await executeToolCall({
      tool: 'read_doc_section',
      logger: new StructuredLogger('error'),
      requestIdFactory: () => requestId,
      monotonicNow: (() => {
        const values = [1, 2];
        let index = 0;
        return () => values[Math.min(index++, values.length - 1)] ?? 0;
      })(),
      execute: async () => ({
        status: 'success',
        warnings: [],
        cacheStatus: 'DISABLED',
        provider: 'catalog',
        data: {
          sectionId: 3,
          found: true,
          truncated: false,
          characterCount: 361,
        },
      }),
      validateResponse: (response) => response,
      formatText: () =>
        'read_doc_section success: Example\nsectionId=3 truncated=false\nExample content',
    });

    expect(result.structuredContent).toMatchObject({ requestId });
    expect(result.content).toEqual([
      {
        type: 'text',
        text:
          `[${EXTERNAL_CONTENT_TRUST}] ${EXTERNAL_CONTENT_SAFETY_NOTICE}\n\n` +
          `requestId=${requestId} cache=DISABLED\n` +
          'read_doc_section success: Example\nsectionId=3 truncated=false\nExample content',
      },
    ]);
  });
});
