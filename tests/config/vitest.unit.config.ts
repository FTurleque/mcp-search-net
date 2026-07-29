import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: [
      'tests/domain/**/*.test.ts',
      'tests/application/**/*.test.ts',
      'tests/presentation/**/*.test.ts',
    ],
    testTimeout: 20_000,
  },
});
