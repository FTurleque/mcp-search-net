import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    exclude: [
      'tests/e2e/mcp-live*.test.ts',
      'tests/integration/**/*.test.ts',
      'tests/performance/**/*.test.ts',
    ],
    testTimeout: 20_000,
  },
});
