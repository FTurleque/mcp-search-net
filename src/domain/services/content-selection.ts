import type { SelectedContent } from '../models/content.js';

interface MarkdownSection {
  readonly heading: string;
  readonly body: string;
  readonly index: number;
}

export function selectRelevantContent(
  markdown: string,
  query: string | undefined,
  maxChars: number,
): SelectedContent {
  const normalized = normalizeMarkdown(markdown);
  const sections = splitMarkdown(normalized);
  const terms = tokenize(query ?? '');

  const selected =
    terms.length === 0
      ? sections
      : sections
          .map((section) => ({ section, score: scoreSection(section, terms) }))
          .filter(({ score }) => score > 0)
          .sort(
            (left, right) => right.score - left.score || left.section.index - right.section.index,
          )
          .slice(0, 12)
          .sort((left, right) => left.section.index - right.section.index)
          .map(({ section }) => section);

  const usefulSections = selected.length === 0 ? sections.slice(0, 3) : selected;
  const rendered = usefulSections.map(renderSection).join('\n\n').trim();
  const truncated = rendered.length > maxChars;
  const limited = truncated ? truncateAtBoundary(rendered, maxChars) : rendered;

  return {
    markdown: limited,
    sectionHeadings: usefulSections.map((section) => section.heading).filter(Boolean),
    truncated,
  };
}

function splitMarkdown(markdown: string): readonly MarkdownSection[] {
  const lines = markdown.split('\n');
  const sections: MarkdownSection[] = [];
  let heading = '';
  let body: string[] = [];
  let index = 0;

  const flush = (): void => {
    const value = body.join('\n').trim();
    if (heading !== '' || value !== '') {
      sections.push({ heading, body: value, index });
      index += 1;
    }
    body = [];
  };

  for (const line of lines) {
    const match = /^(#{1,6})\s+(.+)$/.exec(line);
    if (match !== null) {
      flush();
      heading = `${match[1] ?? '#'} ${match[2]?.trim() ?? ''}`;
    } else {
      body.push(line);
    }
  }
  flush();

  return sections.length === 0 ? [{ heading: '', body: markdown, index: 0 }] : sections;
}

function scoreSection(section: MarkdownSection, terms: readonly string[]): number {
  const heading = section.heading.toLocaleLowerCase();
  const body = section.body.toLocaleLowerCase();
  return terms.reduce((score, term) => {
    const headingMatches = countOccurrences(heading, term);
    const bodyMatches = Math.min(countOccurrences(body, term), 20);
    return score + headingMatches * 8 + bodyMatches;
  }, 0);
}

function tokenize(value: string): readonly string[] {
  return [
    ...new Set(
      value
        .toLocaleLowerCase()
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .split(/[^\p{L}\p{N}]+/u)
        .filter((term) => term.length >= 3),
    ),
  ];
}

function countOccurrences(haystack: string, needle: string): number {
  let count = 0;
  let offset = 0;
  while ((offset = haystack.indexOf(needle, offset)) !== -1) {
    count += 1;
    offset += needle.length;
  }
  return count;
}

function renderSection(section: MarkdownSection): string {
  return [section.heading, section.body].filter(Boolean).join('\n\n');
}

function normalizeMarkdown(value: string): string {
  return value
    .replace(/\r\n?/g, '\n')
    .replace(/\n{4,}/g, '\n\n\n')
    .trim();
}

function truncateAtBoundary(value: string, maxChars: number): string {
  if (maxChars <= 1) return '…';
  const candidate = value.slice(0, maxChars - 1);
  const newline = candidate.lastIndexOf('\n');
  const boundary = newline >= Math.floor(maxChars * 0.7) ? newline : candidate.length;
  return `${candidate.slice(0, boundary).trimEnd()}…`;
}
