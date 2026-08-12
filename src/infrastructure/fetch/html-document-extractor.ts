import {
  MAX_EXTERNAL_TITLE_CHARACTERS,
  truncateUnicode,
} from '../../domain/services/bounded-text.js';
import { normalizeResultUrl } from '../../domain/services/result-ranking.js';
import { sanitizePreparedHtml } from './prepared-html-sanitizer.js';

const NOISY_ATTRIBUTE_NAMES = new Set([
  'class',
  'id',
  'aria-label',
  'role',
  'data-testid',
  'data-test',
  'data-component',
]);
const NOISY_KEYWORDS = [
  'cookie',
  'consent',
  'banner',
  'modal',
  'dialog',
  'sidebar',
  'breadcrumb',
  'pagination',
  'advert',
  'promo',
  'tracking',
  'analytics',
  'footer',
  'header',
  'nav',
  'menu',
  'share',
  'social',
  'newsletter',
  'subscribe',
  'search',
] as const;
const INTERESTING_ATTRIBUTE_NAMES = new Set([...NOISY_ATTRIBUTE_NAMES, 'href', 'rel']);
const METADATA_IGNORED_CONTAINERS = new Set([
  'script',
  'style',
  'noscript',
  'iframe',
  'form',
  'svg',
  'math',
  'canvas',
  'object',
  'embed',
  'video',
  'audio',
]);
const VOID_TAGS = new Set([
  'area',
  'base',
  'br',
  'col',
  'embed',
  'hr',
  'img',
  'input',
  'link',
  'meta',
  'param',
  'source',
  'track',
  'wbr',
]);
const BLOCK_TAGS = new Set([
  'br',
  'p',
  'div',
  'section',
  'article',
  'main',
  'header',
  'footer',
  'table',
  'tr',
]);
const MAX_TITLE_SOURCE_CHARACTERS = MAX_EXTERNAL_TITLE_CHARACTERS * 8;

export interface ExtractedHtmlDocument {
  readonly markdown: string;
  readonly title?: string;
  readonly canonicalUrl?: string;
  readonly links: readonly string[];
  readonly safeHtml: string;
}

interface HtmlTagToken {
  readonly start: number;
  readonly end: number;
  readonly raw: string;
  readonly name?: string;
  readonly closing: boolean;
  readonly selfClosing: boolean;
  readonly attributes: ReadonlyMap<string, string | undefined>;
}

interface HtmlMetadata {
  readonly title?: string;
  readonly canonicalUrl?: string;
}

export function extractHtmlDocument(html: string, baseUrl: string): ExtractedHtmlDocument {
  const metadata = extractMetadata(html, baseUrl);
  const sanitized = sanitizePreparedHtml(html);
  const rendered = renderSanitizedHtml(sanitized, baseUrl);
  return {
    markdown: rendered.markdown,
    ...(metadata.title === undefined ? {} : { title: metadata.title }),
    ...(metadata.canonicalUrl === undefined ? {} : { canonicalUrl: metadata.canonicalUrl }),
    links: rendered.links,
    safeHtml: rendered.safeHtml,
  };
}

function extractMetadata(html: string, baseUrl: string): HtmlMetadata {
  let cursor = 0;
  let titleDepth = 0;
  let titleSource = '';
  let canonicalUrl: string | undefined;
  let ignoredContainer: string | undefined;
  let ignoredDepth = 0;

  for (;;) {
    const tag = nextTag(html, cursor);
    const textEnd = tag?.start ?? html.length;
    if (ignoredContainer === undefined && titleDepth > 0 && titleSource.length < MAX_TITLE_SOURCE_CHARACTERS) {
      titleSource += html.slice(cursor, textEnd).slice(0, MAX_TITLE_SOURCE_CHARACTERS - titleSource.length);
    }
    if (tag === undefined) break;
    cursor = tag.end;
    if (tag.name === undefined) continue;

    if (ignoredContainer !== undefined) {
      if (!tag.closing && !tag.selfClosing && tag.name === ignoredContainer) ignoredDepth += 1;
      if (tag.closing && tag.name === ignoredContainer) {
        ignoredDepth -= 1;
        if (ignoredDepth === 0) ignoredContainer = undefined;
      }
      continue;
    }

    if (!tag.closing && !tag.selfClosing && METADATA_IGNORED_CONTAINERS.has(tag.name)) {
      ignoredContainer = tag.name;
      ignoredDepth = 1;
      continue;
    }

    if (tag.name === 'title') {
      if (tag.closing) titleDepth = Math.max(0, titleDepth - 1);
      else if (!tag.selfClosing) titleDepth += 1;
      continue;
    }

    if (!tag.closing && tag.name === 'link' && canonicalUrl === undefined) {
      const rel = tag.attributes.get('rel')?.toLowerCase().split(/\s+/u) ?? [];
      if (rel.includes('canonical')) {
        const href = tag.attributes.get('href');
        if (href !== undefined) canonicalUrl = normalizeLink(href, baseUrl);
      }
    }
  }

  const decodedTitle = decodeEntities(titleSource).trim();
  return {
    ...(decodedTitle === ''
      ? {}
      : { title: truncateUnicode(decodedTitle, MAX_EXTERNAL_TITLE_CHARACTERS) }),
    ...(canonicalUrl === undefined ? {} : { canonicalUrl }),
  };
}

function renderSanitizedHtml(
  html: string,
  baseUrl: string,
): { readonly markdown: string; readonly links: readonly string[]; readonly safeHtml: string } {
  const preparedParts: string[] = [];
  const markdownParts: string[] = [];
  const links = new Set<string>();
  let cursor = 0;
  let noisyContainer: string | undefined;
  let noisyDepth = 0;
  let headDepth = 0;
  let preDepth = 0;
  let codeDepth = 0;
  let activeLinkTarget: string | undefined;

  for (;;) {
    const tag = nextTag(html, cursor);
    const textEnd = tag?.start ?? html.length;
    const text = html.slice(cursor, textEnd);
    if (noisyContainer === undefined) {
      preparedParts.push(text);
      if (headDepth === 0) markdownParts.push(decodeEntities(text));
    }
    if (tag === undefined) break;
    cursor = tag.end;
    if (tag.name === undefined) {
      if (noisyContainer === undefined) preparedParts.push(tag.raw);
      continue;
    }

    if (noisyContainer !== undefined) {
      if (!tag.closing && !tag.selfClosing && tag.name === noisyContainer) noisyDepth += 1;
      if (tag.closing && tag.name === noisyContainer) {
        noisyDepth -= 1;
        if (noisyDepth === 0) noisyContainer = undefined;
      }
      continue;
    }

    if (!tag.closing && isNoisyTag(tag)) {
      if (!tag.selfClosing && !VOID_TAGS.has(tag.name)) {
        noisyContainer = tag.name;
        noisyDepth = 1;
      }
      continue;
    }

    preparedParts.push(tag.raw);
    if (tag.closing) {
      if (tag.name === 'head') headDepth = Math.max(0, headDepth - 1);
      if (tag.name === 'pre') {
        preDepth = Math.max(0, preDepth - 1);
        if (headDepth === 0) markdownParts.push('\n```\n\n');
      } else if (tag.name === 'code' && preDepth === 0) {
        codeDepth = Math.max(0, codeDepth - 1);
        if (headDepth === 0) markdownParts.push('`');
      } else if (/^h[1-6]$/u.test(tag.name) && headDepth === 0) {
        markdownParts.push('\n\n');
      } else if (tag.name === 'a' && activeLinkTarget !== undefined) {
        if (headDepth === 0) markdownParts.push(`](${activeLinkTarget})`);
        activeLinkTarget = undefined;
      } else if (BLOCK_TAGS.has(tag.name) && headDepth === 0) {
        markdownParts.push('\n');
      }
      continue;
    }

    if (tag.name === 'head' && !tag.selfClosing) {
      headDepth += 1;
      continue;
    }
    if (headDepth > 0) continue;

    if (/^h[1-6]$/u.test(tag.name)) {
      const level = Number(tag.name[1]);
      markdownParts.push(`\n\n${'#'.repeat(level)} `);
      continue;
    }
    if (tag.name === 'pre') {
      preDepth += 1;
      markdownParts.push('\n\n```\n');
      continue;
    }
    if (tag.name === 'code' && preDepth === 0) {
      codeDepth += 1;
      markdownParts.push('`');
      continue;
    }
    if (tag.name === 'li') {
      markdownParts.push('\n- ');
      continue;
    }
    if (tag.name === 'a') {
      const href = tag.attributes.get('href');
      const normalized = href === undefined ? undefined : normalizeLink(href, baseUrl);
      if (normalized !== undefined) {
        links.add(normalized);
        if (activeLinkTarget !== undefined) markdownParts.push(`](${activeLinkTarget})`);
        activeLinkTarget = normalized;
        markdownParts.push('[');
      }
      continue;
    }
    if (BLOCK_TAGS.has(tag.name)) markdownParts.push('\n');
  }

  if (activeLinkTarget !== undefined) markdownParts.push(`](${activeLinkTarget})`);
  while (codeDepth > 0) {
    markdownParts.push('`');
    codeDepth -= 1;
  }
  while (preDepth > 0) {
    markdownParts.push('\n```\n');
    preDepth -= 1;
  }

  const markdown = markdownParts
    .join('')
    .replace(/[ \t]+/gu, ' ')
    .replace(/\n[ \t]+/gu, '\n')
    .replace(/[ \t]+\n/gu, '\n')
    .replace(/\n{3,}/gu, '\n\n')
    .trim();
  return { markdown, links: [...links], safeHtml: preparedParts.join('') };
}

function isNoisyTag(tag: HtmlTagToken): boolean {
  for (const name of NOISY_ATTRIBUTE_NAMES) {
    const value = tag.attributes.get(name)?.toLowerCase();
    if (value !== undefined && NOISY_KEYWORDS.some((keyword) => value.includes(keyword))) {
      return true;
    }
  }
  return false;
}

function nextTag(html: string, from: number): HtmlTagToken | undefined {
  let searchFrom = from;
  while (searchFrom < html.length) {
    const start = html.indexOf('<', searchFrom);
    if (start === -1) return undefined;
    const tag = parseTagAt(html, start);
    if (tag !== undefined) return tag;
    searchFrom = start + 1;
  }
  return undefined;
}

function parseTagAt(html: string, start: number): HtmlTagToken | undefined {
  if (html.startsWith('<!--', start)) {
    const closing = html.indexOf('-->', start + 4);
    const end = closing === -1 ? html.length : closing + 3;
    return {
      start,
      end,
      raw: html.slice(start, end),
      closing: false,
      selfClosing: true,
      attributes: new Map(),
    };
  }

  const next = html[start + 1];
  if (next === undefined) return undefined;
  if (next !== '/' && next !== '!' && next !== '?' && !isAsciiLetter(next)) return undefined;

  const closingIndex = findTagEnd(html, start);
  const end = closingIndex === undefined ? html.length : closingIndex + 1;
  const raw = html.slice(start, end);
  if (next === '!' || next === '?') {
    return { start, end, raw, closing: false, selfClosing: true, attributes: new Map() };
  }

  let index = 1;
  let closing = false;
  if (raw[index] === '/') {
    closing = true;
    index += 1;
  }
  while (isHtmlSpace(raw[index])) index += 1;
  const nameStart = index;
  while (isTagNameCharacter(raw[index])) index += 1;
  if (index === nameStart) return undefined;
  const name = raw.slice(nameStart, index).toLowerCase();
  const selfClosing = !closing && (VOID_TAGS.has(name) || isExplicitlySelfClosing(raw));
  return {
    start,
    end,
    raw,
    name,
    closing,
    selfClosing,
    attributes: closing ? new Map() : parseInterestingAttributes(raw, index),
  };
}

function findTagEnd(html: string, start: number): number | undefined {
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

function parseInterestingAttributes(
  raw: string,
  start: number,
): ReadonlyMap<string, string | undefined> {
  const attributes = new Map<string, string | undefined>();
  let index = start;
  while (index < raw.length) {
    while (isHtmlSpace(raw[index]) || raw[index] === '/') index += 1;
    if (index >= raw.length || raw[index] === '>') break;

    const nameStart = index;
    while (
      index < raw.length &&
      !isHtmlSpace(raw[index]) &&
      raw[index] !== '=' &&
      raw[index] !== '>' &&
      raw[index] !== '/'
    ) {
      index += 1;
    }
    const name = raw.slice(nameStart, index).toLowerCase();
    while (isHtmlSpace(raw[index])) index += 1;

    let value: string | undefined;
    if (raw[index] === '=') {
      index += 1;
      while (isHtmlSpace(raw[index])) index += 1;
      const quote = raw[index];
      if (quote === '"' || quote === "'") {
        index += 1;
        const valueStart = index;
        while (index < raw.length && raw[index] !== quote) index += 1;
        value = raw.slice(valueStart, index);
        if (raw[index] === quote) index += 1;
      } else {
        const valueStart = index;
        while (
          index < raw.length &&
          !isHtmlSpace(raw[index]) &&
          raw[index] !== '>' &&
          raw[index] !== '/'
        ) {
          index += 1;
        }
        value = raw.slice(valueStart, index);
      }
    }
    if (INTERESTING_ATTRIBUTE_NAMES.has(name) && !attributes.has(name)) {
      attributes.set(name, value);
    }
  }
  return attributes;
}

function isExplicitlySelfClosing(raw: string): boolean {
  let index = raw.length - 2;
  while (index >= 0 && isHtmlSpace(raw[index])) index -= 1;
  return raw[index] === '/';
}

function isHtmlSpace(character: string | undefined): boolean {
  return character === ' ' || character === '\n' || character === '\r' || character === '\t' || character === '\f';
}

function isAsciiLetter(character: string): boolean {
  const code = character.charCodeAt(0);
  return (code >= 65 && code <= 90) || (code >= 97 && code <= 122);
}

function isTagNameCharacter(character: string | undefined): boolean {
  if (character === undefined) return false;
  const code = character.charCodeAt(0);
  return (
    (code >= 48 && code <= 57) ||
    (code >= 65 && code <= 90) ||
    (code >= 97 && code <= 122) ||
    character === ':' ||
    character === '-'
  );
}

function normalizeLink(value: string, baseUrl: string): string | undefined {
  try {
    return normalizeResultUrl(new URL(decodeEntities(value), baseUrl).toString());
  } catch {
    return undefined;
  }
}

function decodeEntities(value: string): string {
  return value
    .replace(/&nbsp;/gu, ' ')
    .replace(/&amp;/gu, '&')
    .replace(/&lt;/gu, '<')
    .replace(/&gt;/gu, '>')
    .replace(/&quot;/gu, '"')
    .replace(/&#39;/gu, "'");
}
