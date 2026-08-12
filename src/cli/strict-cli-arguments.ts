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

    if (!argument.startsWith('-')) {
      positionalArguments += 1;
      if (positionalArguments > maximumPositionalArguments) {
        throw new Error(`Unexpected argument ${argument}`);
      }
      continue;
    }

    if (seenOptions.has(argument)) {
      throw new Error(`Duplicate option ${argument}`);
    }

    if (flags.has(argument)) {
      seenOptions.add(argument);
      continue;
    }

    if (valueOptions.has(argument)) {
      const value = argv[index + 1];
      if (value === undefined || value === '' || value.startsWith('-')) {
        throw new Error(`Missing value for ${argument}`);
      }
      seenOptions.add(argument);
      index += 1;
      continue;
    }

    throw new Error(`Unknown option ${argument}`);
  }

  for (const mutuallyExclusiveOptions of spec.mutuallyExclusiveOptions ?? []) {
    const presentOptions = mutuallyExclusiveOptions.filter((option) => seenOptions.has(option));
    if (presentOptions.length > 1) {
      throw new Error(`Options ${presentOptions.join(' and ')} are mutually exclusive`);
    }
  }
}
