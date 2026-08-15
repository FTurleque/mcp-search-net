import process from 'node:process';

import Database from 'better-sqlite3';

import {
  configureSqliteConnection,
  SQLITE_BUSY_TIMEOUT_MS,
} from '../../src/infrastructure/sqlite-connection.js';

const [path, documentIdText, versionIdText, holdMsText] = process.argv.slice(2);
if (path === undefined || documentIdText === undefined || versionIdText === undefined) {
  throw new Error('Missing catalog promotion fixture arguments');
}

const documentId = Number(documentIdText);
const versionId = Number(versionIdText);
const holdMs = Number(holdMsText ?? '250');
if (
  !Number.isSafeInteger(documentId) ||
  documentId <= 0 ||
  !Number.isSafeInteger(versionId) ||
  versionId <= 0 ||
  !Number.isSafeInteger(holdMs) ||
  holdMs < 0
) {
  throw new Error('Invalid catalog promotion fixture arguments');
}

const database = new Database(path, { timeout: SQLITE_BUSY_TIMEOUT_MS });
configureSqliteConnection(database);

try {
  database.exec('BEGIN IMMEDIATE');
  database
    .prepare('UPDATE document_versions SET is_current = 0 WHERE document_id = ?')
    .run(documentId);
  database
    .prepare('UPDATE document_versions SET is_current = 1 WHERE id = ? AND document_id = ?')
    .run(versionId, documentId);
  database
    .prepare('UPDATE documents SET current_version_id = ? WHERE id = ?')
    .run(versionId, documentId);
  database
    .prepare(
      `DELETE FROM document_section_fts
       WHERE rowid IN (
         SELECT document_sections.id
         FROM document_sections
         INNER JOIN document_versions
           ON document_versions.id = document_sections.document_version_id
         WHERE document_versions.document_id = ?
       )`,
    )
    .run(documentId);
  database
    .prepare(
      `INSERT INTO document_section_fts(
        rowid, section_id, document_id, source_key, language,
        title, heading, heading_path, content
      )
      SELECT
        document_sections.id,
        document_sections.id,
        documents.id,
        catalog_sources.source_key,
        documents.language,
        documents.title,
        coalesce(document_sections.heading, ''),
        coalesce(document_sections.heading_path, ''),
        document_sections.content
      FROM document_sections
      INNER JOIN document_versions
        ON document_versions.id = document_sections.document_version_id
       AND document_versions.id = ?
       AND document_versions.is_current = 1
      INNER JOIN documents
        ON documents.id = document_versions.document_id
       AND documents.current_version_id = document_versions.id
      INNER JOIN catalog_sources
        ON catalog_sources.id = documents.source_id
      WHERE documents.id = ?
        AND documents.status = 'ACTIVE'
        AND catalog_sources.enabled = 1`,
    )
    .run(versionId, documentId);
  process.send?.({ type: 'ready' });

  setTimeout(() => {
    try {
      database.exec('COMMIT');
      database.close();
      process.exit(0);
    } catch (error) {
      if (database.inTransaction) database.exec('ROLLBACK');
      database.close();
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
      process.exit(1);
    }
  }, holdMs);
} catch (error) {
  if (database.inTransaction) database.exec('ROLLBACK');
  database.close();
  throw error;
}
