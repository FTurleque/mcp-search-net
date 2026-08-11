import { describe, expect, it } from 'vitest';

import { parseStrictInteger } from '../../src/cli/strict-integer.js';

describe('parseStrictInteger', () => {
  it.each([
    ['0', 0, 0],
    ['1', 0, 1],
    ['10', 1, 10],
    ['500', 1, 500],
  ])('accepts the complete integer string %s', (value, minimum, expected) => {
    expect(parseStrictInteger(value, '--value', minimum)).toBe(expected);
  });

  it.each(['1.5', '1e3', '10foo', '500ms', '3abc', '+10', '-1', ' 10foo', 'NaN', 'Infinity'])(
    'rejects partial or non-decimal integer input %s',
    (value) => {
      expect(() => parseStrictInteger(value, '--value', 0)).toThrow(`Invalid --value ${value}`);
    },
  );
});
