import { describe, expect, it } from 'vitest';

import { checksumMigrationSql } from '../../src/infrastructure/cache/migrations.js';

describe('cache migration checksum normalization', () => {
  it('treats LF, CRLF, and an optional UTF-8 BOM as the same logical migration', () => {
    const lf = 'CREATE TABLE example (\n  id INTEGER PRIMARY KEY\n);\n';
    const crlf = lf.replaceAll('\n', '\r\n');
    const bomLf = `\uFEFF${lf}`;
    const bomCrlf = `\uFEFF${crlf}`;

    const expected = checksumMigrationSql(lf);
    expect(checksumMigrationSql(crlf)).toBe(expected);
    expect(checksumMigrationSql(bomLf)).toBe(expected);
    expect(checksumMigrationSql(bomCrlf)).toBe(expected);
  });

  it('still changes the checksum when migration semantics change', () => {
    expect(checksumMigrationSql('SELECT 1;\n')).not.toBe(checksumMigrationSql('SELECT 2;\n'));
  });
});
