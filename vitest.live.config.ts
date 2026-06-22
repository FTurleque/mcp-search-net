import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/e2e/mcp-live*.test.ts'],
    testTimeout: 60_000,
    hookTimeout: 60_000,
    maxConcurrency: 1,
  },
});
