import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    coverage: {
      reporter: ['text', 'html'],
    },
    include: ['tests/**/*.test.ts'],
    exclude: ['tests/e2e/mcp-live*.test.ts', 'tests/integration/**', 'tests/performance/**'],
    testTimeout: 15_000,
  },
});
