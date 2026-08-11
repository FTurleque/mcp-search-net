import type { ContentSection, SelectedContent } from '../models/content.js';
import { countUnicodeCharacters } from './bounded-text.js';
import { scanMarkdownHeadings } from './markdown-structure.js';

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

  const rankedCandidates = sections
    .map((section) => ({
      section,
      score: terms.length === 0 ? 1 / (section.index + 1) : lexicalRelevance(section, terms),
    }))
    .filter(({ score }) => terms.length === 0 || score > 0)
    .sort((left, right) => right.score - left.score || left.section.index - right.section.index);
  const ranked = rankedCandidates.slice(0, maxSections);

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
  let contentTruncated = rankedCandidates.length > ranked.length;
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
    const renderedCharacters = countUnicodeCharacters(rendered);
    const truncated = renderedCharacters > sectionBudget;
    const value = truncated ? truncateAtBoundary(rendered, sectionBudget) : rendered;
    if (truncated) sectionTruncated = true;
    selected.push({
      heading: stripHeadingMarker(section.heading),
      markdown: value,
      score: Number(score.toFixed(6)),
      truncated,
    });
    remaining -= countUnicodeCharacters(value);
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
  const lines = markdown.split('\n');
  const headings = scanMarkdownHeadings(lines);
  if (headings.length === 0) {
    const section = createMarkdownSection('', markdown, 0);
    return section === undefined ? [] : [section];
  }

  const sections: MarkdownSection[] = [];
  const firstHeading = headings[0];
  const preamble = lines
    .slice(0, firstHeading?.lineIndex ?? 0)
    .join('\n')
    .trim();
  if (preamble !== '') {
    const section = createMarkdownSection('', preamble, sections.length);
    if (section !== undefined) sections.push(section);
  }

  headings.forEach((heading, index) => {
    const nextHeading = headings[index + 1];
    const body = lines
      .slice(heading.lineIndex + 1, nextHeading?.lineIndex ?? lines.length)
      .join('\n')
      .trim();
    const section = createMarkdownSection(
      `${'#'.repeat(heading.level)} ${heading.title}`,
      body,
      sections.length,
    );
    if (section !== undefined) sections.push(section);
  });
  return sections;
}

function createMarkdownSection(
  heading: string,
  body: string,
  index: number,
): MarkdownSection | undefined {
  const value = body.trim();
  if (heading === '' && value === '') return undefined;
  return { heading, body: value, index, tokens: tokenize(`${heading} ${value}`) };
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
  if (maxCharacters <= 0) return '';
  if (maxCharacters === 1) return '…';

  const candidate = Array.from(value).slice(0, maxCharacters - 1);
  let boundary = -1;
  for (let index = candidate.length - 1; index >= 0; index -= 1) {
    const character = candidate[index];
    if (character === '\n' || character === ' ') {
      boundary = index;
      break;
    }
  }
  const minimumBoundary = Math.floor(maxCharacters * 0.7);
  const end = boundary >= minimumBoundary ? boundary : candidate.length;
  return `${candidate.slice(0, end).join('').trimEnd()}…`;
}
