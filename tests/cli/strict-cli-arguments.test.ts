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

  it('accepts positional arguments when the spec allows them', () => {
    const specWithPositional = { ...SPEC, positionalArguments: 1 } as const;
    expect(() => assertStrictCliArguments(['input.txt'], specWithPositional)).not.toThrow();
  });

  it('rejects a second positional argument beyond the allowed count', () => {
    const specWithOnePositional = { ...SPEC, positionalArguments: 1 } as const;
    expect(() =>
      assertStrictCliArguments(['first.txt', 'second.txt'], specWithOnePositional),
    ).toThrow('Unexpected argument second.txt');
  });

  it('enforces mutually exclusive options', () => {
    const specWithExclusives = {
      ...SPEC,
      mutuallyExclusiveOptions: [['--path', '--keep']] as const,
    };
    expect(() =>
      assertStrictCliArguments(['--path', 'a.db', '--keep', '3'], specWithExclusives),
    ).toThrow('Options --path and --keep are mutually exclusive');
  });

  it('accepts when only one option from a mutually exclusive group is present', () => {
    const specWithExclusives = {
      ...SPEC,
      mutuallyExclusiveOptions: [['--path', '--keep']] as const,
    };
    expect(() => assertStrictCliArguments(['--path', 'a.db'], specWithExclusives)).not.toThrow();
  });

  it('rejects a value option with an empty string value', () => {
    expect(() => assertStrictCliArguments(['--path', ''], SPEC)).toThrow(
      'Missing value for --path',
    );
  });
});
