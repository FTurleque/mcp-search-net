import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { OfficialSourceYamlRegistry } from '../../src/infrastructure/config/official-source-yaml-registry.js';
import { loadConfiguration } from '../../src/infrastructure/config/load-configuration.js';

describe('OfficialSourceYamlRegistry', () => {
  const registry = new OfficialSourceYamlRegistry({
    version: 1,
    sources: [
      {
        id: 'example',
        name: 'Example',
        domain: 'docs.example.com',
        baseUrl: 'https://docs.example.com/sdk',
        pathPrefix: '/sdk',
        includeSubdomains: true,
        githubOrganizations: ['ExampleOrg'],
        keywords: ['example sdk'],
        priority: 10,
        enabled: true,
      },
    ],
  });

  it('matches configured GitHub organizations without hostname or path confusion', () => {
    expect(registry.findByUrl('https://github.com/exampleorg/project')?.id).toBe('example');
    expect(registry.findByUrl('https://www.github.com/ExampleOrg/project')?.id).toBe('example');
    expect(registry.findByUrl('https://github.com/exampleorg-attacker/project')).toBeUndefined();
    expect(
      registry.findByUrl('https://github.com.attacker.test/ExampleOrg/project'),
    ).toBeUndefined();
    expect(registry.findByUrl('http://github.com/ExampleOrg/project')).toBeUndefined();
  });

  it('loads every benchmark source from the project registry', async () => {
    const loaded = await loadConfiguration(resolve('config/application.yml'));
    const ids = loaded.officialSources.list().map((source) => source.id);

    expect(ids).toEqual(
      expect.arrayContaining([
        'jetbrains',
        'openjdk',
        'maven',
        'quarkus',
        'javafx',
        'oracle',
        'sonar',
        'docker',
      ]),
    );
    expect(
      loaded.officialSources.findByUrl('https://github.com/JetBrains/intellij-community')?.id,
    ).toBe('jetbrains');
  });

  it('matches exact domains and proper subdomain boundaries', () => {
    expect(registry.findByUrl('https://docs.example.com/sdk/a')?.id).toBe('example');
    expect(registry.findByUrl('https://v2.docs.example.com/sdk/a')?.id).toBe('example');
    expect(registry.findByUrl('https://docs.example.com/other')).toBeUndefined();
    expect(registry.findByUrl('https://docs.example.com.attacker.test/sdk/a')).toBeUndefined();
    expect(registry.findByUrl('http://docs.example.com/sdk/a')).toBeUndefined();
    expect(registry.findByUrl('http://v2.docs.example.com/sdk/a')).toBeUndefined();
  });

  it('rejects a configured baseUrl containing userinfo credentials', () => {
    const buildRegistry = (baseUrl: string) =>
      new OfficialSourceYamlRegistry({
        version: 1,
        sources: [
          {
            id: 'example',
            name: 'Example',
            domain: 'example.com',
            baseUrl,
            includeSubdomains: false,
            githubOrganizations: [],
            keywords: ['example'],
            priority: 1,
            enabled: true,
          },
        ],
      });

    expect(() => buildRegistry('https://token@example.com/docs')).toThrow(
      'must not contain userinfo credentials',
    );
    expect(() => buildRegistry('https://user:password@example.com/docs')).toThrow(
      'must not contain userinfo credentials',
    );
    expect(() => buildRegistry('https://example.com/docs')).not.toThrow();
  });
});
