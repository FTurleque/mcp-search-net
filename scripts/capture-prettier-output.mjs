import { cpSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const files = [
  'docs/reference/catalog-sync-v2.md',
  'src/application/ports/catalog-repository.ts',
  'src/application/use-cases/fetch-url.ts',
  'src/application/use-cases/sync-catalog-documents.ts',
  'src/infrastructure/catalog/sqlite-catalog-repository.ts',
  'src/infrastructure/fetch/secure-http-gateway.ts',
  'tests/application/audit-fetch-url-remediation.test.ts',
  'tests/application/audit-sync-remediation.test.ts',
  'tests/application/load-catalog-sources.test.ts',
  'tests/infrastructure/audit-catalog-remediation.test.ts',
  'tests/infrastructure/audit-http-remediation.test.ts',
];

const destinationRoot = resolve('.data/test-reports/prettier-formatted');
for (const file of files) {
  const destination = resolve(destinationRoot, file);
  mkdirSync(dirname(destination), { recursive: true });
  cpSync(resolve(file), destination);
}
