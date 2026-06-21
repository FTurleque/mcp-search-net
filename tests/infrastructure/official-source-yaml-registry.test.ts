import { describe, expect, it } from 'vitest';

import { OfficialSourceYamlRegistry } from '../../src/infrastructure/config/official-source-yaml-registry.js';

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
        keywords: ['example sdk'],
        priority: 10,
        enabled: true,
      },
    ],
  });

  it('matches exact domains and proper subdomain boundaries', () => {
    expect(registry.findByUrl('https://docs.example.com/sdk/a')?.id).toBe('example');
    expect(registry.findByUrl('https://v2.docs.example.com/sdk/a')?.id).toBe('example');
    expect(registry.findByUrl('https://docs.example.com/other')).toBeUndefined();
    expect(registry.findByUrl('https://docs.example.com.attacker.test/sdk/a')).toBeUndefined();
  });
});
