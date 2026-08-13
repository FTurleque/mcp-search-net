export const MAX_EXTERNAL_TITLE_CHARACTERS = 512;
export const MAX_EXTERNAL_ENGINE_NAME_CHARACTERS = 128;
export const MAX_EXTERNAL_LANGUAGE_CHARACTERS = 35;
export const MAX_EXTERNAL_SOURCE_NAME_CHARACTERS = 200;
export const MAX_EXTERNAL_SOURCE_KEY_CHARACTERS = 128;
export const MAX_EXTERNAL_DOCUMENT_PUBLIC_ID_CHARACTERS = 128;
export const MAX_EXTERNAL_HEADING_CHARACTERS = 256;
export const MAX_EXTERNAL_HEADING_PATH_CHARACTERS = 1_024;
export const MAX_EXTERNAL_ANCHOR_CHARACTERS = 256;
export const MAX_EXTERNAL_DOCUMENT_SECTIONS = 256;
export const MAX_PERSISTED_DOCUMENT_SECTIONS = 1_024;
export const MAX_CATALOG_STABLE_KEY_CHARACTERS = 512;
export const MAX_CATALOG_MIME_TYPE_CHARACTERS = 255;
export const MAX_CATALOG_URL_CHARACTERS = 4_096;
export const MAX_CATALOG_VERSION_LABEL_CHARACTERS = 256;
export const MAX_MARKDOWN_STRUCTURAL_LINES = 20_000;

export function countUnicodeCharacters(value: string): number {
  return Array.from(value).length;
}

export function truncateUnicode(value: string, maxCharacters: number): string {
  if (!Number.isSafeInteger(maxCharacters) || maxCharacters < 0) {
    throw new RangeError('maxCharacters must be a non-negative safe integer');
  }

  const characters = Array.from(value);
  if (characters.length <= maxCharacters) return value;
  if (maxCharacters === 0) return '';
  if (maxCharacters === 1) return '…';

  return `${characters
    .slice(0, maxCharacters - 1)
    .join('')
    .trimEnd()}…`;
}
