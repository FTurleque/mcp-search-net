import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

import * as ts from 'typescript';
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

  it('detects static, side-effect, re-export, dynamic and require module loading syntax', () => {
    const source = [
      "import value from './static.js';",
      "import './side-effect.js';",
      "export * from './re-export.js';",
      "const dynamic = import('./dynamic.js');",
      "const legacy = require('./legacy.cjs');",
      "import alias = require('./import-equals.cjs');",
    ].join('\n');

    expect(moduleSpecifiers(source, 'architecture-fixture.ts')).toEqual([
      './static.js',
      './side-effect.js',
      './re-export.js',
      './dynamic.js',
      './legacy.cjs',
      './import-equals.cjs',
    ]);
  });
});

function forbiddenImports(
  layer: string,
  predicate: (specifier: string) => boolean,
): readonly string[] {
  const layerRoot = join(sourceRoot, layer);
  return typescriptFiles(layerRoot).flatMap((path) => {
    const source = readFileSync(path, 'utf8');
    return moduleSpecifiers(source, path)
      .filter(predicate)
      .map((specifier) => `${relative(sourceRoot, path)} -> ${specifier}`);
  });
}

function moduleSpecifiers(source: string, path: string): readonly string[] {
  const sourceFile = ts.createSourceFile(
    path,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const specifiers: string[] = [];

  const visit = (node: ts.Node): void => {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier !== undefined &&
      ts.isStringLiteralLike(node.moduleSpecifier)
    ) {
      specifiers.push(node.moduleSpecifier.text);
    } else if (
      ts.isImportEqualsDeclaration(node) &&
      ts.isExternalModuleReference(node.moduleReference) &&
      ts.isStringLiteralLike(node.moduleReference.expression)
    ) {
      specifiers.push(node.moduleReference.expression.text);
    } else if (ts.isCallExpression(node)) {
      const [argument] = node.arguments;
      if (
        node.arguments.length === 1 &&
        argument !== undefined &&
        ts.isStringLiteralLike(argument) &&
        (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
          (ts.isIdentifier(node.expression) && node.expression.text === 'require'))
      ) {
        specifiers.push(argument.text);
      }
    }
    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return specifiers;
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
