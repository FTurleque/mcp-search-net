import type { ContentSection, SelectedContent } from '../models/content.js';

interface MarkdownSection {
  readonly heading: string;
  readonly body: string;
  readonly index: number;
  readonly tokens: readonly string[];
}

const MAX_SECTION_CHARACTERS = 5_000;

export function extractDocumentSections(
  markdown: string,
): readonly { readonly heading: string; readonly markdown: string }[] {
  return splitMarkdown(normalizeMarkdown(markdown)).map((section) => ({
    heading: stripHeadingMarker(section.heading),
    markdown: renderSection(section),
  }));
}

export function selectRelevantContent(
  markdown: string,
  query: string | undefined,
  maxCharacters: number,
  maxSections: number,
): SelectedContent {
  const sections = splitMarkdown(normalizeMarkdown(markdown));
  const terms = tokenize(query ?? '');

  const ranked = sections
    .map((section) => ({
      section,
      score: terms.length === 0 ? 1 / (section.index + 1) : lexicalRelevance(section, terms),
    }))
    .filter(({ score }) => terms.length === 0 || score > 0)
    .sort((left, right) => right.score - left.score || left.section.index - right.section.index)
    .slice(0, maxSections);

  if (ranked.length === 0) {
    return {
      sections: [],
      markdown: '',
      truncated: false,
      sectionTruncated: false,
      noRelevantSection: true,
    };
  }

  let remaining = maxCharacters;
  let contentTruncated = ranked.length < sections.length;
  let sectionTruncated = false;
  const selected: ContentSection[] = [];

  for (const { section, score } of ranked) {
    if (selected.length > 0) remaining -= 2;
    if (remaining <= 0) {
      contentTruncated = true;
      break;
    }
    const rendered = renderSection(section);
    const sectionBudget = Math.min(MAX_SECTION_CHARACTERS, remaining);
    const truncated = rendered.length > sectionBudget;
    const value = truncated ? truncateAtBoundary(rendered, sectionBudget) : rendered;
    if (truncated) sectionTruncated = true;
    selected.push({
      heading: stripHeadingMarker(section.heading),
      markdown: value,
      score: Number(score.toFixed(6)),
      truncated,
    });
    remaining -= value.length;
  }

  return {
    sections: selected,
    markdown: selected.map((section) => section.markdown).join('\n\n'),
    truncated: contentTruncated || sectionTruncated,
    sectionTruncated,
    noRelevantSection: false,
  };
}

function lexicalRelevance(section: MarkdownSection, terms: readonly string[]): number {
  const uniqueTerms = [...new Set(terms)];
  const headingTokens = tokenize(section.heading);
  const hasCode = /```[\s\S]*?```/u.test(section.body);
  const matchedScore = uniqueTerms.reduce((score, term) => {
    if (!section.tokens.includes(term)) return score;
    const titleBonus = headingTokens.includes(term) ? 0.5 : 0;
    const versionBonus = /^v?\d+(?:\.\d+)+$/u.test(term) ? 0.25 : 0;
    return score + 1 + titleBonus + versionBonus;
  }, 0);
  const raw = matchedScore === 0 ? 0 : matchedScore + (hasCode ? 0.1 : 0);
  const maximum = Math.max(1, uniqueTerms.length * 1.75 + 0.1);
  return Math.min(1, raw / maximum);
}

function splitMarkdown(markdown: string): readonly MarkdownSection[] {
  const sections: MarkdownSection[] = [];
  let heading = '';
  let body: string[] = [];
  let inCode = false;
  const flush = (): void => {
    const value = body.join('\n').trim();
    if (heading !== '' || value !== '') {
      sections.push({
        heading,
        body: value,
        index: sections.length,
        tokens: tokenize(`${heading} ${value}`),
      });
    }
    body = [];
  };
  for (const line of markdown.split('\n')) {
    if (/^\s*```/u.test(line)) inCode = !inCode;
    const match = inCode ? null : /^(#{1,6})\s+(.+)$/u.exec(line);
    if (match === null) body.push(line);
    else {
      flush();
      heading = `${match[1] ?? '#'} ${match[2]?.trim() ?? ''}`;
    }
  }
  flush();
  return sections.length === 0
    ? [{ heading: '', body: markdown, index: 0, tokens: tokenize(markdown) }]
    : sections;
}

function tokenize(value: string): readonly string[] {
  return value
    .normalize('NFKD')
    .toLocaleLowerCase()
    .replace(/[\u0300-\u036f]/gu, '')
    .split(/[^\p{L}\p{N}.]+/u)
    .filter((term) => term.length >= 2);
}

function renderSection(section: MarkdownSection): string {
  return [section.heading, section.body].filter(Boolean).join('\n\n');
}

function stripHeadingMarker(value: string): string {
  return value.replace(/^#{1,6}\s+/u, '');
}

function normalizeMarkdown(value: string): string {
  return value
    .replace(/\r\n?/gu, '\n')
    .replace(/\n{4,}/gu, '\n\n\n')
    .trim();
}

function truncateAtBoundary(value: string, maxCharacters: number): string {
  if (maxCharacters <= 1) return '…'.slice(0, maxCharacters);
  const candidate = value.slice(0, maxCharacters - 1);
  const boundary = Math.max(candidate.lastIndexOf('\n'), candidate.lastIndexOf(' '));
  const end = boundary >= Math.floor(maxCharacters * 0.7) ? boundary : candidate.length;
  return `${candidate.slice(0, end).trimEnd()}…`;
}
