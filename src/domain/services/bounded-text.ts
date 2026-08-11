export const MAX_EXTERNAL_TITLE_CHARACTERS = 512;
export const MAX_EXTERNAL_ENGINE_NAME_CHARACTERS = 128;

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
