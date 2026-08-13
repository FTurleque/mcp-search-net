import { describe, expect, it } from 'vitest';

import { scanMarkdownHeadings } from '../../src/domain/services/markdown-structure.js';

describe('scanMarkdownHeadings', () => {
  it.each(['```', '~~~', '~~~~'])('ignores shell-style headings inside %s fences', (fence) => {
    const headings = scanMarkdownHeadings(
      ['# Guide', `${fence}bash`, '# shell comment', fence, '## Install'].join('\n').split('\n'),
    );

    expect(headings.map(({ title }) => title)).toEqual(['Guide', 'Install']);
    expect(headings[1]?.headingPath).toBe('Guide > Install');
  });

  it('requires a compatible closing fence character and length', () => {
    const headings = scanMarkdownHeadings([
      '# Root',
      '````markdown',
      '```',
      '# Still code',
      '~~~~',
      '# Still code too',
      '````',
      '## Visible',
    ]);

    expect(headings).toMatchObject([
      { lineIndex: 0, level: 1, title: 'Root', headingPath: 'Root' },
      { lineIndex: 7, level: 2, title: 'Visible', headingPath: 'Root > Visible' },
    ]);
  });

  it('handles multiple blocks, Unicode titles and nested paths outside fences', () => {
    const headings = scanMarkdownHeadings([
      '# Référence',
      '```ts',
      '## Caché',
      '```',
      '## Déploiement',
      '~~~yaml',
      '### Caché aussi',
      '~~~',
      '### Étape finale 🚀',
    ]);

    expect(headings.map(({ title, headingPath }) => ({ title, headingPath }))).toEqual([
      { title: 'Référence', headingPath: 'Référence' },
      { title: 'Déploiement', headingPath: 'Référence > Déploiement' },
      {
        title: 'Étape finale 🚀',
        headingPath: 'Référence > Déploiement > Étape finale 🚀',
      },
    ]);
  });
});
