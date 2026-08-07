const ACTIVE_CONTAINER_TAGS = [
  'script',
  'style',
  'noscript',
  'iframe',
  'form',
  'nav',
  'aside',
  'svg',
  'math',
  'canvas',
  'object',
  'embed',
  'video',
  'audio',
] as const;

const RESOURCE_TAGS = ['link', 'meta', 'base', 'source', 'img', 'input', 'track'] as const;

const UNSAFE_HTML_ATTRIBUTES = new Set([
  'src',
  'srcset',
  'srcdoc',
  'action',
  'formaction',
  'poster',
  'data',
  'background',
  'ping',
  'xlink:href',
  'style',
]);

const HTML_ATTRIBUTE_ASSIGNMENT_PATTERN = /\s([^\s=/>]+)\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gu;
const HTML_START_PATTERN = /<[A-Za-z]/gu;
const ACTIVE_CONTAINER_START_PATTERN = new RegExp(
  String.raw`<\s*(${ACTIVE_CONTAINER_TAGS.join('|')})\b`,
  'giu',
);
const RESOURCE_TAG_PATTERN = new RegExp(
  String.raw`<\s*(?:${RESOURCE_TAGS.join('|')})\b[^>]*(?:>|$)`,
  'giu',
);

/**
 * Produces conservative HTML for Crawl4AI's raw:// transport.
 *
 * Active containers are removed together with their contents. If an active block is malformed or
 * never closed, everything from its opening tag to EOF is discarded instead of being handed to a
 * browser parser. Resource-loading elements are removed entirely and resource/event attributes are
 * stripped from the remaining well-formed start tags. An unterminated start tag is likewise dropped
 * together with the remainder because quote recovery rules differ across HTML parsers.
 */
export function sanitizePreparedHtml(html: string): string {
  const withoutComments = html.replace(/<!--[\s\S]*?(?:-->|$)/gu, ' ');
  const withoutActiveContainers = removeActiveContainers(withoutComments);
  const withoutResourceTags = withoutActiveContainers.replace(RESOURCE_TAG_PATTERN, ' ');
  return stripUnsafeHtmlAttributes(withoutResourceTags);
}

function removeActiveContainers(html: string): string {
  let output = '';
  let cursor = 0;

  for (;;) {
    ACTIVE_CONTAINER_START_PATTERN.lastIndex = cursor;
    const opening = ACTIVE_CONTAINER_START_PATTERN.exec(html);
    if (opening === null) return output + html.slice(cursor);

    output += html.slice(cursor, opening.index);
    const tagName = opening[1]?.toLowerCase();
    if (tagName === undefined) return output;

    const closingPattern = new RegExp(String.raw`<\/\s*${tagName}\s*>`, 'giu');
    closingPattern.lastIndex = ACTIVE_CONTAINER_START_PATTERN.lastIndex;
    const closing = closingPattern.exec(html);
    if (closing === null) return output;

    cursor = closing.index + closing[0].length;
  }
}

function stripUnsafeHtmlAttributes(html: string): string {
  let output = '';
  let cursor = 0;

  for (;;) {
    HTML_START_PATTERN.lastIndex = cursor;
    const start = HTML_START_PATTERN.exec(html);
    if (start === null) return output + html.slice(cursor);

    output += html.slice(cursor, start.index);
    const end = findStartTagEnd(html, start.index);
    if (end === undefined) return output;

    const tag = html.slice(start.index, end + 1);
    output += tag.replace(HTML_ATTRIBUTE_ASSIGNMENT_PATTERN, (attribute, rawName: string) =>
      isUnsafeHtmlAttribute(rawName) ? '' : attribute,
    );
    cursor = end + 1;
  }
}

function findStartTagEnd(html: string, start: number): number | undefined {
  let quote: '"' | "'" | undefined;
  for (let index = start + 1; index < html.length; index += 1) {
    const character = html[index];
    if (quote !== undefined) {
      if (character === quote) quote = undefined;
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      continue;
    }
    if (character === '>') return index;
  }
  return undefined;
}

function isUnsafeHtmlAttribute(rawName: string): boolean {
  const name = rawName.toLowerCase();
  return name.startsWith('on') || UNSAFE_HTML_ATTRIBUTES.has(name);
}
