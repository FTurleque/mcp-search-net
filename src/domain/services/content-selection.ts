import type { ContentSection, SelectedContent } from '../models/content.js';

interface MarkdownSection {
  readonly heading: string;
  readonly body: string;
  readonly index: number;
  readonly tokens: readonly string[];
}

const MAX_SECTION_CHARACTERS = 5_000;

export function selectRelevantContent(
  markdown: string,
  query: string | undefined,
  maxCharacters: number,
  maxSections: number,
): SelectedContent {
  const sections = splitMarkdown(normalizeMarkdown(markdown));
  const terms = tokenize(query ?? '');
  const averageLength = Math.max(
    1,
    sections.reduce((total, section) => total + section.tokens.length, 0) / sections.length,
  );

  const ranked = sections
    .map((section) => ({
      section,
      score:
        terms.length === 0
          ? 1 / (section.index + 1)
          : bm25(section, sections, terms, averageLength),
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

function bm25(
  section: MarkdownSection,
  corpus: readonly MarkdownSection[],
  terms: readonly string[],
  averageLength: number,
): number {
  const k1 = 1.2;
  const b = 0.75;
  const headingTokens = tokenize(section.heading);
  const codeBonus = /```[\s\S]*?```/u.test(section.body) ? 0.2 : 0;
  return terms.reduce((score, term) => {
    const frequency = section.tokens.filter((token) => token === term).length;
    if (frequency === 0) return score;
    const documents = corpus.filter((candidate) => candidate.tokens.includes(term)).length;
    const idf = Math.log(1 + (corpus.length - documents + 0.5) / (documents + 0.5));
    const normalized =
      (frequency * (k1 + 1)) /
      (frequency + k1 * (1 - b + b * (section.tokens.length / averageLength)));
    const titleBonus = headingTokens.includes(term) ? 1.5 : 0;
    const versionBonus = /^v?\d+(?:\.\d+)+$/u.test(term) ? 0.5 : 0;
    return score + idf * normalized + titleBonus + versionBonus;
  }, codeBonus);
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
