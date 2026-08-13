import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';
import { z } from 'zod/v4';

import { ConfigurationError } from '../../src/domain/errors/domain-errors.js';
import { loadYaml, parseStrictYaml } from '../../src/infrastructure/config/yaml-loader.js';

const SIMPLE_SCHEMA = z.object({ name: z.string(), count: z.number() });

describe('parseStrictYaml', () => {
  it('parses a valid YAML string into a plain object', () => {
    const result = parseStrictYaml('name: foo\ncount: 42', 'test.yml');
    expect(result).toEqual({ name: 'foo', count: 42 });
  });

  it('throws ConfigurationError for syntactically invalid YAML', () => {
    expect(() => parseStrictYaml('key: [unclosed', 'bad.yml')).toThrow(ConfigurationError);
  });

  it('throws ConfigurationError when document has YAML errors (duplicate keys)', () => {
    const yaml = 'key: a\nkey: b\n';
    expect(() => parseStrictYaml(yaml, 'dup.yml')).toThrow(ConfigurationError);
  });

  it('throws ConfigurationError when alias expansion exceeds maxAliasCount', () => {
    const yaml = 'anchor: &ref value\nalias: *ref\n';
    expect(() => parseStrictYaml(yaml, 'alias.yml')).toThrow(ConfigurationError);
  });
});

describe('loadYaml', () => {
  let tmpDir: string | undefined;

  async function withTmpDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
    tmpDir = await mkdtemp(join(tmpdir(), 'mcp-yaml-test-'));
    try {
      return await fn(tmpDir);
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
      tmpDir = undefined;
    }
  }

  it('loads and validates a well-formed YAML file', async () => {
    await withTmpDir(async (dir) => {
      const file = join(dir, 'valid.yml');
      await writeFile(file, 'name: hello\ncount: 7\n');
      const result = await loadYaml(file, SIMPLE_SCHEMA);
      expect(result).toEqual({ name: 'hello', count: 7 });
    });
  });

  it('throws ConfigurationError when the file does not exist', async () => {
    await expect(loadYaml('/nonexistent/path/missing.yml', SIMPLE_SCHEMA)).rejects.toThrow(
      ConfigurationError,
    );
  });

  it('throws ConfigurationError when the file exists but fails schema validation', async () => {
    await withTmpDir(async (dir) => {
      const file = join(dir, 'invalid-schema.yml');
      await writeFile(file, 'name: hello\ncount: not-a-number\n');
      await expect(loadYaml(file, SIMPLE_SCHEMA)).rejects.toThrow(ConfigurationError);
    });
  });

  it('includes validation issue details in the error message', async () => {
    await withTmpDir(async (dir) => {
      const file = join(dir, 'missing-field.yml');
      await writeFile(file, 'name: hello\n');
      await expect(loadYaml(file, SIMPLE_SCHEMA)).rejects.toThrow(/count/);
    });
  });
});
