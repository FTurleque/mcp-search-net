import {
  MAX_EXTERNAL_DOCUMENT_SECTIONS,
  MAX_EXTERNAL_HEADING_CHARACTERS,
  MAX_EXTERNAL_HEADING_PATH_CHARACTERS,
  truncateUnicode,
} from './bounded-text.js';

export interface MarkdownHeading {
  readonly lineIndex: number;
  readonly level: number;
  readonly title: string;
  readonly headingPath: string;
}

interface MarkdownFence {
  readonly marker: '`' | '~';
  readonly length: number;
}

export function scanMarkdownHeadings(
  lines: readonly string[],
  maximumHeadings = MAX_EXTERNAL_DOCUMENT_SECTIONS,
): readonly MarkdownHeading[] {
  if (!Number.isSafeInteger(maximumHeadings) || maximumHeadings <= 0) return [];

  const headings: MarkdownHeading[] = [];
  const stack: string[] = [];
  let fence: MarkdownFence | undefined;

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    if (headings.length >= maximumHeadings) break;
    const line = lines[lineIndex] ?? '';
    if (fence !== undefined) {
      if (isClosingFence(line, fence)) fence = undefined;
      continue;
    }

    const openingFence = parseOpeningFence(line);
    if (openingFence !== undefined) {
      fence = openingFence;
      continue;
    }

    const match = /^ {0,3}(#{1,6})[\t ]+(.+?)\s*$/u.exec(line);
    if (match === null) continue;
    const level = match[1]?.length ?? 1;
    const rawTitle = (match[2] ?? '').replace(/[\t ]+#+[\t ]*$/u, '').trim(); // NOSONAR
    if (rawTitle === '') continue;
    const title = truncateUnicode(rawTitle, MAX_EXTERNAL_HEADING_CHARACTERS);
    stack.splice(level - 1, stack.length, title);
    headings.push({
      lineIndex,
      level,
      title,
      headingPath: truncateUnicode(
        stack.slice(0, level).join(' > '),
        MAX_EXTERNAL_HEADING_PATH_CHARACTERS,
      ),
    });
  }

  return headings;
}

function parseOpeningFence(line: string): MarkdownFence | undefined {
  const match = /^ {0,3}(`{3,}|~{3,})[^\r\n]*$/u.exec(line); // NOSONAR
  if (match === null) return undefined;
  const sequence = match[1] ?? '';
  const marker = sequence[0];
  if (marker !== '`' && marker !== '~') return undefined;
  return { marker, length: sequence.length };
}

function isClosingFence(line: string, fence: MarkdownFence): boolean {
  const match = /^ {0,3}(`+|~+)[\t ]*$/u.exec(line);
  const sequence = match?.[1];
  return sequence?.startsWith(fence.marker) === true && sequence.length >= fence.length;
}
