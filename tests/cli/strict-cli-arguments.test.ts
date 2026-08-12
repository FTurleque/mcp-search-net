import { describe, expect, it } from 'vitest';

import { assertStrictCliArguments } from '../../src/cli/strict-cli-arguments.js';

const SPEC = {
  valueOptions: ['--path', '--keep'],
  flags: ['--dry-run'],
} as const;

describe('strict CLI argument validation', () => {
  it('accepts known flags and value options', () => {
    expect(() =>
      assertStrictCliArguments(['--path', 'catalog.db', '--keep', '3', '--dry-run'], SPEC),
    ).not.toThrow();
  });

  it('rejects unknown options so a misspelled dry-run cannot become a real mutation', () => {
    expect(() => assertStrictCliArguments(['--dry-rnu'], SPEC)).toThrow('Unknown option --dry-rnu');
  });

  it('rejects duplicate options', () => {
    expect(() => assertStrictCliArguments(['--path', 'one.db', '--path', 'two.db'], SPEC)).toThrow(
      'Duplicate option --path',
    );
  });

  it('rejects a value option whose value is another option', () => {
    expect(() => assertStrictCliArguments(['--path', '--dry-run'], SPEC)).toThrow(
      'Missing value for --path',
    );
  });

  it('rejects unexpected positional arguments', () => {
    expect(() => assertStrictCliArguments(['unexpected'], SPEC)).toThrow(
      'Unexpected argument unexpected',
    );
  });
});
