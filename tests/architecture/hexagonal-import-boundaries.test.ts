import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const sourceRoot = resolve('src');

describe('hexagonal import boundaries', () => {
  it('keeps the domain independent from runtime and outer layers', () => {
    expect(forbiddenImports('domain', (specifier) => !specifier.startsWith('.'))).toEqual([]);
    expect(
      forbiddenImports('domain', (specifier) => referencesLayer(specifier, 'infrastructure')),
    ).toEqual([]);
    expect(
      forbiddenImports('domain', (specifier) => referencesLayer(specifier, 'presentation')),
    ).toEqual([]);
  });

  it('keeps application use cases independent from infrastructure and presentation', () => {
    expect(
      forbiddenImports('application', (specifier) => referencesLayer(specifier, 'infrastructure')),
    ).toEqual([]);
    expect(
      forbiddenImports('application', (specifier) => referencesLayer(specifier, 'presentation')),
    ).toEqual([]);
  });

  it('keeps infrastructure independent from presentation and bootstrap', () => {
    expect(
      forbiddenImports('infrastructure', (specifier) => referencesLayer(specifier, 'presentation')),
    ).toEqual([]);
    expect(
      forbiddenImports('infrastructure', (specifier) => referencesLayer(specifier, 'bootstrap')),
    ).toEqual([]);
  });

  it('keeps MCP presentation independent from concrete infrastructure', () => {
    expect(
      forbiddenImports('presentation', (specifier) => referencesLayer(specifier, 'infrastructure')),
    ).toEqual([]);
  });
});

function forbiddenImports(
  layer: string,
  predicate: (specifier: string) => boolean,
): readonly string[] {
  const layerRoot = join(sourceRoot, layer);
  return typescriptFiles(layerRoot).flatMap((path) => {
    const source = readFileSync(path, 'utf8');
    return [...source.matchAll(/\bfrom\s+['"]([^'"]+)['"]/gu)]
      .map((match) => match[1] ?? '')
      .filter(predicate)
      .map((specifier) => `${relative(sourceRoot, path)} -> ${specifier}`);
  });
}

function typescriptFiles(root: string): readonly string[] {
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const path = join(root, entry.name);
    if (entry.isDirectory()) return typescriptFiles(path);
    return entry.isFile() && path.endsWith('.ts') ? [path] : [];
  });
}

function referencesLayer(specifier: string, layer: string): boolean {
  return specifier.split(/[\\/]/u).includes(layer);
}
