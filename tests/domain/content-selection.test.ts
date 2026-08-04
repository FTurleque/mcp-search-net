import { describe, expect, it } from 'vitest';

import {
  extractDocumentSections,
  selectRelevantContent,
} from '../../src/domain/services/content-selection.js';

describe('extractDocumentSections', () => {
  it('keeps a document without headings as one section', () => {
    expect(extractDocumentSections('Plain documentation.\n\nSecond paragraph.')).toEqual([
      {
        heading: '',
        markdown: 'Plain documentation.\n\nSecond paragraph.',
      },
    ]);
  });

  it('preserves the preamble before the first heading', () => {
    expect(
      extractDocumentSections('Introductory preamble.\n\n# Install\n\nRun the installer.'),
    ).toEqual([
      { heading: '', markdown: 'Introductory preamble.' },
      { heading: 'Install', markdown: '# Install\n\nRun the installer.' },
    ]);
  });

  it('keeps nested headings in document order', () => {
    expect(
      extractDocumentSections(
        '# Guide\n\nOverview.\n\n## Install\n\nSteps.\n\n### Windows\n\nDetails.',
      ),
    ).toEqual([
      { heading: 'Guide', markdown: '# Guide\n\nOverview.' },
      { heading: 'Install', markdown: '## Install\n\nSteps.' },
      { heading: 'Windows', markdown: '### Windows\n\nDetails.' },
    ]);
  });

  it.each(['', '   ', '\r\n\r\n'])('does not create a section for empty Markdown', (markdown) => {
    expect(extractDocumentSections(markdown)).toEqual([]);
  });
});

describe('selectRelevantContent', () => {
  const markdown = `# Introduction

General text about the project.

## Authentication

Use a bearer token for authentication and keep it secret.

## Deployment

Run the service with Docker Compose.
`;

  it('selects sections matching the query with deterministic lexical relevance', () => {
    const result = selectRelevantContent(markdown, 'bearer authentication token', 5_000, 5);
    expect(result.markdown).toContain('## Authentication');
    expect(result.markdown).not.toContain('## Deployment');
    expect(result.sections.map((section) => section.heading)).toEqual(['Authentication']);
  });

  it('enforces the global content budget', () => {
    const result = selectRelevantContent(markdown, undefined, 80, 5);
    expect(result.markdown.length).toBeLessThanOrEqual(80);
    expect(result.markdown.endsWith('…')).toBe(true);
    expect(result.truncated).toBe(true);
  });

  it('does not silently return unrelated sections', () => {
    const result = selectRelevantContent(markdown, 'kubernetes operator', 5_000, 5);
    expect(result.sections).toEqual([]);
    expect(result.noRelevantSection).toBe(true);
  });

  it('keeps fenced code inside its section and applies the 5000 character cap', () => {
    const source = `# API\n\n\`\`\`ts\n${'token '.repeat(1_000)}\n\`\`\``;
    const result = selectRelevantContent(source, 'token', 10_000, 5);
    expect(result.sections).toHaveLength(1);
    expect(result.sections[0]?.markdown.length).toBeLessThanOrEqual(5_000);
    expect(result.sectionTruncated).toBe(true);
  });
});
