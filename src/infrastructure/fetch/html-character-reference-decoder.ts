const HTML_CHARACTER_REFERENCE_PATTERN = /&(?:#[0-9]+|#x[0-9a-f]+|[a-z][a-z0-9]+);/giu;

const NAMED_HTML_ENTITIES: Readonly<Record<string, string>> = {
  amp: '&',
  apos: "'",
  bull: '•',
  cent: '¢',
  copy: '©',
  deg: '°',
  divide: '÷',
  euro: '€',
  gt: '>',
  hellip: '…',
  laquo: '«',
  ldquo: '“',
  lsquo: '‘',
  lt: '<',
  mdash: '—',
  middot: '·',
  nbsp: ' ',
  ndash: '–',
  para: '¶',
  plusmn: '±',
  pound: '£',
  quot: '"',
  raquo: '»',
  rdquo: '”',
  reg: '®',
  rsquo: '’',
  sect: '§',
  times: '×',
  trade: '™',
  yen: '¥',
};

export function decodeHtmlCharacterReferences(value: string): string {
  return value.replace(HTML_CHARACTER_REFERENCE_PATTERN, (entity) =>
    decodeCharacterReference(entity),
  );
}

function decodeCharacterReference(entity: string): string {
  const body = entity.slice(1, -1);
  if (body.startsWith('#x') || body.startsWith('#X')) return decodeNumericEntity(body.slice(2), 16);
  if (body.startsWith('#')) return decodeNumericEntity(body.slice(1), 10);
  return NAMED_HTML_ENTITIES[body.toLowerCase()] ?? entity;
}

function decodeNumericEntity(digits: string, radix: 10 | 16): string {
  const codePoint = Number.parseInt(digits, radix);
  if (
    !Number.isFinite(codePoint) ||
    codePoint === 0 ||
    codePoint > 0x10ffff ||
    (codePoint >= 0xd800 && codePoint <= 0xdfff)
  ) {
    return '�';
  }
  return String.fromCodePoint(codePoint);
}
