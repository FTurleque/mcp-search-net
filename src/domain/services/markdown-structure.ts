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

export function scanMarkdownHeadings(lines: readonly string[]): readonly MarkdownHeading[] {
  const headings: MarkdownHeading[] = [];
  const stack: string[] = [];
  let fence: MarkdownFence | undefined;

  lines.forEach((line, lineIndex) => {
    if (fence !== undefined) {
      if (isClosingFence(line, fence)) fence = undefined;
      return;
    }

    const openingFence = parseOpeningFence(line);
    if (openingFence !== undefined) {
      fence = openingFence;
      return;
    }

    const match = /^ {0,3}(#{1,6})[\t ]+(.+?)\s*$/u.exec(line);
    if (match === null) return;
    const level = match[1]?.length ?? 1;
    const title = (match[2] ?? '').replace(/[\t ]+#+[\t ]*$/u, '').trim();
    if (title === '') return;
    stack.splice(level - 1, stack.length, title);
    headings.push({
      lineIndex,
      level,
      title,
      headingPath: stack.slice(0, level).join(' > '),
    });
  });

  return headings;
}

function parseOpeningFence(line: string): MarkdownFence | undefined {
  const match = /^ {0,3}(`{3,}|~{3,})[^\r\n]*$/u.exec(line);
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
