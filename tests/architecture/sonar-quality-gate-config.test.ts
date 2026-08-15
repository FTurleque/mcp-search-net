import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const repositoryRoot = resolve(import.meta.dirname, '../..');

describe('Sonar quality gate configuration', () => {
  it('waits for the Quality Gate before the GitHub Actions job can succeed', () => {
    const properties = readFileSync(resolve(repositoryRoot, 'sonar-project.properties'), 'utf8');
    const configuredValue = properties
      .split(/\r?\n/u)
      .map((line) => line.trim())
      .find((line) => line.startsWith('sonar.qualitygate.wait='));

    expect(configuredValue).toBe('sonar.qualitygate.wait=true');
  });
});
