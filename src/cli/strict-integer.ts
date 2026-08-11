export function parseStrictInteger(
  value: string | undefined,
  optionName: string,
  minimum: number,
): number | undefined {
  if (value === undefined) return undefined;
  if (!/^(?:0|[1-9]\d*)$/u.test(value)) throw new Error(`Invalid ${optionName} ${value}`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum) {
    throw new Error(`Invalid ${optionName} ${value}`);
  }
  return parsed;
}
