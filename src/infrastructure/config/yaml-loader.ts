import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { parseDocument } from 'yaml';
import type { ZodType } from 'zod/v4';

import { ConfigurationError } from '../../domain/errors/domain-errors.js';

export async function loadYaml<T>(path: string, schema: ZodType<T>): Promise<T> {
  const absolutePath = resolve(path);
  let source: string;
  try {
    source = await readFile(absolutePath, 'utf8');
  } catch (error) {
    throw new ConfigurationError(`Cannot read configuration file: ${absolutePath}`, {
      cause: error,
    });
  }

  const value = parseStrictYaml(source, absolutePath);
  const result = schema.safeParse(value);
  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `${issue.path.join('.') || '<root>'}: ${issue.message}`)
      .join('; ');
    throw new ConfigurationError(`Invalid configuration in ${absolutePath}: ${issues}`);
  }

  return result.data;
}

export function parseStrictYaml(source: string, context: string): unknown {
  const document = parseDocument(source, {
    prettyErrors: true,
    strict: true,
    uniqueKeys: true,
  });

  if (document.errors.length > 0) {
    throw new ConfigurationError(
      `Invalid YAML in ${context}: ${document.errors.map((error) => error.message).join('; ')}`,
    );
  }

  try {
    return document.toJS({ maxAliasCount: 0 });
  } catch (error) {
    throw new ConfigurationError(`Cannot materialize YAML document: ${context}`, {
      cause: error,
    });
  }
}
