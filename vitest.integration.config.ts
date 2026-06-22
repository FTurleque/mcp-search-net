import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: [
      'tests/contract/provider-contract.test.ts',
      'tests/infrastructure/application-config.test.ts',
      'tests/infrastructure/crawl4ai-content-fetcher.test.ts',
      'tests/infrastructure/searxng-search-provider.test.ts',
      'tests/infrastructure/sqlite-cache-repository.test.ts',
    ],
    testTimeout: 20_000,
    hookTimeout: 20_000,
    maxConcurrency: 1,
  },
});
