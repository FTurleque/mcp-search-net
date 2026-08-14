import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      reporter: ['text', 'json-summary', 'html', 'lcov'],
      reportsDirectory: 'coverage',
      thresholds: {
        statements: 80,
        branches: 70,
        functions: 85,
        lines: 83,
        'src/infrastructure/security/public-url-security-policy.ts': {
          statements: 85,
          branches: 70,
          functions: 90,
          lines: 90,
        },
        'src/infrastructure/fetch/secure-http-gateway.ts': {
          statements: 74,
          branches: 60,
          functions: 85,
          lines: 80,
        },
        'src/infrastructure/fetch/crawl4ai-content-fetcher.ts': {
          statements: 85,
          branches: 75,
          functions: 85,
          lines: 85,
        },
        'src/infrastructure/catalog/catalog-migration-runner.ts': {
          statements: 90,
          branches: 85,
          functions: 95,
          lines: 90,
        },
        'src/infrastructure/catalog/catalog-migrations.ts': {
          statements: 80,
          branches: 50,
          functions: 100,
          lines: 95,
        },
        'src/infrastructure/catalog/catalog-integrity.ts': {
          statements: 80,
          branches: 50,
          functions: 70,
          lines: 80,
        },
        'src/infrastructure/catalog/sqlite-catalog-repository.ts': {
          statements: 80,
          branches: 60,
          functions: 85,
          lines: 85,
        },
        'src/infrastructure/catalog/sqlite-catalog-revision-writer.ts': {
          statements: 80,
          branches: 55,
          functions: 85,
          lines: 85,
        },
        'src/infrastructure/catalog/sqlite-catalog-search.ts': {
          statements: 80,
          branches: 60,
          functions: 85,
          lines: 85,
        },
        'src/infrastructure/catalog/sqlite-catalog-sync-store.ts': {
          statements: 80,
          branches: 55,
          functions: 85,
          lines: 85,
        },
        'src/application/use-cases/sync-catalog-documents.ts': {
          statements: 88,
          branches: 65,
          functions: 90,
          lines: 90,
        },
        'src/presentation/mcp/tool-call.ts': {
          statements: 90,
          branches: 60,
          functions: 100,
          lines: 90,
        },
        'src/presentation/mcp/mcp-server-v2.ts': {
          statements: 85,
          branches: 45,
          functions: 90,
          lines: 88,
        },
        'src/presentation/mcp/catalog-resources.ts': {
          statements: 90,
          branches: 60,
          functions: 95,
          lines: 95,
        },
      },
    },
    include: ['tests/**/*.test.ts'],
    exclude: ['tests/e2e/*live*.test.ts', 'tests/integration/**', 'tests/performance/**'],
    testTimeout: 30_000,
  },
});
