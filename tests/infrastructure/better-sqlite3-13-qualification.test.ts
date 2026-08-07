import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';

const roots: string[] = [];

afterEach(() => {
  roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true }));
});

describe('better-sqlite3 13 / N-API qualification', () => {
  it('exposes the expected SQLite engine and a working FTS5 index', () => {
    const database = new Database(':memory:');
    try {
      const row = database.prepare('SELECT sqlite_version() AS version').get() as {
        readonly version: string;
      };
      expect(compareVersions(row.version, '3.53.4')).toBeGreaterThanOrEqual(0);

      database.exec('CREATE VIRTUAL TABLE documents_fts USING fts5(title, body)');
      database
        .prepare('INSERT INTO documents_fts(title, body) VALUES (?, ?)')
        .run(
          'N-API migration',
          'SQLite FTS5 remains available after the native dependency upgrade.',
        );

      const result = database
        .prepare(
          "SELECT title FROM documents_fts WHERE documents_fts MATCH 'native dependency' LIMIT 1",
        )
        .get() as { readonly title: string } | undefined;
      expect(result?.title).toBe('N-API migration');
    } finally {
      database.close();
    }
  });

  it('preserves SQLite writer locking across independent connections', () => {
    const root = mkdtempSync(join(tmpdir(), 'mcp-better-sqlite3-13-'));
    roots.push(root);
    const path = join(root, 'locking.db');
    const first = new Database(path);
    const second = new Database(path);

    try {
      first.exec('CREATE TABLE records(id INTEGER PRIMARY KEY, value TEXT NOT NULL)');
      second.pragma('busy_timeout = 1');
      first.exec('BEGIN IMMEDIATE');
      first.prepare('INSERT INTO records(value) VALUES (?)').run('first');

      expect(() =>
        second.prepare('INSERT INTO records(value) VALUES (?)').run('blocked'),
      ).toThrow();

      first.exec('COMMIT');
      second.prepare('INSERT INTO records(value) VALUES (?)').run('second');
      const count = second.prepare('SELECT COUNT(*) AS count FROM records').get() as {
        readonly count: number;
      };
      expect(count.count).toBe(2);
    } finally {
      if (first.inTransaction) first.exec('ROLLBACK');
      first.close();
      second.close();
    }
  });
});

function compareVersions(left: string, right: string): number {
  const leftParts = left.split('.').map(Number);
  const rightParts = right.split('.').map(Number);
  const length = Math.max(leftParts.length, rightParts.length);
  for (let index = 0; index < length; index += 1) {
    const difference = (leftParts[index] ?? 0) - (rightParts[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
}
