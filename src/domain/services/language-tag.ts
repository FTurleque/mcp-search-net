import { countUnicodeCharacters, MAX_EXTERNAL_LANGUAGE_CHARACTERS } from './bounded-text.js';

export function normalizeLanguageTag(value: string, errorCode = 'LANGUAGE_TAG_INVALID'): string {
  const trimmed = value.trim();
  let canonical: string | undefined;
  try {
    canonical = Intl.getCanonicalLocales(trimmed)[0];
  } catch {
    throw new Error(errorCode);
  }
  if (
    canonical === undefined ||
    canonical === '' ||
    countUnicodeCharacters(canonical) > MAX_EXTERNAL_LANGUAGE_CHARACTERS
  ) {
    throw new Error(errorCode);
  }
  return canonical;
}
