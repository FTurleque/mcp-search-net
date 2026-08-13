export interface StrictCliArgumentSpec {
  readonly valueOptions?: readonly string[];
  readonly flags?: readonly string[];
  readonly positionalArguments?: number;
  readonly mutuallyExclusiveOptions?: readonly (readonly string[])[];
}

export function assertStrictCliArguments(
  argv: readonly string[],
  spec: StrictCliArgumentSpec,
): void {
  const valueOptions = new Set(spec.valueOptions ?? []);
  const flags = new Set(spec.flags ?? []);
  const maximumPositionalArguments = spec.positionalArguments ?? 0;
  const seenOptions = new Set<string>();
  let positionalArguments = 0;

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === undefined) continue;
    const indexAdvance = processCliArgument(
      argument,
      index,
      argv,
      flags,
      valueOptions,
      seenOptions,
      positionalArguments,
      maximumPositionalArguments,
    );
    if (indexAdvance === -1) {
      positionalArguments += 1;
    } else {
      index += indexAdvance;
    }
  }

  validateMutualExclusions(spec.mutuallyExclusiveOptions ?? [], seenOptions);
}

function processCliArgument( // NOSONAR
  argument: string,
  index: number,
  argv: readonly string[],
  flags: ReadonlySet<string>,
  valueOptions: ReadonlySet<string>,
  seenOptions: Set<string>,
  positionalArguments: number,
  maximumPositionalArguments: number,
): number {
  if (!argument.startsWith('-')) {
    if (positionalArguments + 1 > maximumPositionalArguments) {
      throw new Error(`Unexpected argument ${argument}`);
    }
    return -1;
  }
  if (seenOptions.has(argument)) throw new Error(`Duplicate option ${argument}`);
  if (flags.has(argument)) {
    seenOptions.add(argument);
    return 0;
  }
  if (valueOptions.has(argument)) {
    const value = argv[index + 1];
    if (value === undefined || value === '' || value.startsWith('-')) {
      throw new Error(`Missing value for ${argument}`);
    }
    seenOptions.add(argument);
    return 1;
  }
  throw new Error(`Unknown option ${argument}`);
}

function validateMutualExclusions(
  groups: readonly (readonly string[])[],
  seenOptions: ReadonlySet<string>,
): void {
  for (const group of groups) {
    const present = group.filter((option) => seenOptions.has(option));
    if (present.length > 1)
      throw new Error(`Options ${present.join(' and ')} are mutually exclusive`);
  }
}
