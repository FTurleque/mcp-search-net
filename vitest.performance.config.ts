import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/performance/**/*.test.ts'],
    testTimeout: 30_000,
    maxConcurrency: 1,
  },
});
