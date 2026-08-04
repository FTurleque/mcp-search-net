import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: [
      'tests/application/search-web.test.ts',
      'tests/application/fetch-url.test.ts',
      'tests/infrastructure/sqlite-cache-repository.test.ts',
      'tests/infrastructure/http-utils.test.ts',
    ],
    testTimeout: 20_000,
  },
});
