import { describe, expect, it } from 'vitest';

import { selectRelevantContent } from '../../src/domain/services/content-selection.js';

describe('selectRelevantContent', () => {
  const markdown = `# Introduction

General text about the project.

## Authentication

Use a bearer token for authentication and keep it secret.

## Deployment

Run the service with Docker Compose.
`;

  it('selects sections matching the query', () => {
    const result = selectRelevantContent(markdown, 'bearer authentication token', 5_000);

    expect(result.markdown).toContain('## Authentication');
    expect(result.markdown).not.toContain('## Deployment');
    expect(result.sectionHeadings).toEqual(['## Authentication']);
  });

  it('enforces the content budget', () => {
    const result = selectRelevantContent(markdown, undefined, 80);

    expect(result.markdown.length).toBeLessThanOrEqual(80);
    expect(result.markdown.endsWith('…')).toBe(true);
    expect(result.truncated).toBe(true);
  });
});
