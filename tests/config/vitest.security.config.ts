import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: [
      'tests/security/**/*.test.ts',
      'tests/infrastructure/public-url-security-policy.test.ts',
      'tests/infrastructure/secure-http-gateway.test.ts',
      'tests/presentation/tool-call.test.ts',
    ],
    testTimeout: 20_000,
  },
});
