import type { z } from 'zod/v4';

export const INVALID_TOOL_INPUT = Symbol('invalid-tool-input');

const invalidToolInputFallback = Object.freeze({ [INVALID_TOOL_INPUT]: true });

export function acceptInvalidToolInput<T extends z.ZodType>(schema: T): z.ZodCatch<T> {
  const recovered = schema.catch(invalidToolInputFallback as z.output<T>);

  // The MCP SDK only advertises schemas it can normalize as Zod objects. ZodCatch
  // intentionally hides the wrapped object's shape, so expose that read-only
  // shape to the SDK while keeping the catch parser used for INVALID_ARGUMENT.
  const source = schema as unknown as ZodSchemaInternals;
  const target = recovered as unknown as ZodSchemaInternals;
  const shape = source._zod?.def.shape;
  const targetDefinition = target._zod?.def;
  if (shape !== undefined && targetDefinition !== undefined) {
    Object.defineProperty(targetDefinition, 'shape', {
      value: shape,
      enumerable: false,
      configurable: false,
      writable: false,
    });
  }
  return recovered;
}

export function isInvalidToolInput(value: unknown): boolean {
  return (
    typeof value === 'object' &&
    value !== null &&
    INVALID_TOOL_INPUT in value &&
    value[INVALID_TOOL_INPUT] === true
  );
}

interface ZodSchemaInternals {
  readonly _zod?: {
    readonly def: {
      readonly shape?: unknown;
    };
  };
}
