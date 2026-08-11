import { z } from 'zod/v4';

import { countUnicodeCharacters } from '../../../domain/services/bounded-text.js';

/**
 * Advertise a finite JSON-Schema maxLength without reverting to UTF-16 semantics.
 *
 * Zod's built-in max length counts JavaScript UTF-16 code units, while the MCP
 * contract counts Unicode code points. A supplementary-plane character occupies
 * at most two UTF-16 units, so the built-in guard is deliberately set to 2x and
 * the exact Unicode limit remains enforced by the refinement.
 */
export function unicodeBoundedString(maximumCharacters: number, minimumCharacters = 0) {
  return z
    .string()
    .min(minimumCharacters)
    .max(maximumCharacters * 2)
    .refine((value) => countUnicodeCharacters(value) <= maximumCharacters, {
      message: `Must contain at most ${maximumCharacters} Unicode characters`,
    });
}
