import type Database from 'better-sqlite3';

import type {
  CatalogIntegrityIssue,
  CatalogIntegrityReport,
} from '../../application/ports/catalog-repository.js';

interface CountRow {
  readonly count: number;
}

interface IntegrityCheckRow {
  readonly integrity_check: string;
}

interface ForeignKeyCheckRow {
  readonly table: string;
  readonly rowid: number | null;
  readonly parent: string;
  readonly fkid: number;
}

interface DocumentIssueRow {
  readonly source_key: string;
  readonly public_id: string;
}

interface SectionIssueRow extends DocumentIssueRow {
  readonly section_id: number;
}

const DROP_FTS_INTEGRITY_TEMP_TABLES_SQL = `
  DROP TABLE IF EXISTS temp.catalog_integrity_actual_vocab;
  DROP TABLE IF EXISTS temp.catalog_integrity_expected_vocab;
  DROP TABLE IF EXISTS temp.catalog_integrity_expected_fts;
`;

export function verifyCatalogIntegrity(database: Database.Database): CatalogIntegrityReport {
  const integrityRows = database.prepare<[], IntegrityCheckRow>('PRAGMA integrity_check').all();
  const sqliteIntegrityCheck = integrityRows.map((row) => row.integrity_check).join('; ');
  const issues: CatalogIntegrityIssue[] = [];

  for (const row of integrityRows) {
    if (row.integrity_check !== 'ok') {
      issues.push({
        code: 'SQLITE_INTEGRITY_CHECK_FAILED',
        message: `SQLite integrity_check: ${row.integrity_check}`,
      });
    }
  }

  const foreignKeyRows = database.prepare<[], ForeignKeyCheckRow>('PRAGMA foreign_key_check').all();
  for (const row of foreignKeyRows) {
    issues.push({
      code: 'SQLITE_FOREIGN_KEY_CHECK_FAILED',
      message: `Foreign key violation in ${row.table} row ${String(row.rowid)} referencing ${row.parent} (fk ${row.fkid})`,
    });
  }

  appendDocumentIssues(
    database,
    issues,
    'ACTIVE_DOCUMENT_WITHOUT_CURRENT_VERSION',
    `
      SELECT catalog_sources.source_key, documents.public_id
      FROM documents
      INNER JOIN catalog_sources ON catalog_sources.id = documents.source_id
      WHERE documents.status = 'ACTIVE'
        AND documents.current_version_id IS NULL
      ORDER BY catalog_sources.source_key, documents.public_id
    `,
    (row) => `Active document ${row.public_id} has no current version`,
  );
  appendDocumentIssues(
    database,
    issues,
    'CURRENT_VERSION_MISSING_OR_WRONG_DOCUMENT',
    `
      SELECT catalog_sources.source_key, documents.public_id
      FROM documents
      INNER JOIN catalog_sources ON catalog_sources.id = documents.source_id
      LEFT JOIN document_versions
        ON document_versions.id = documents.current_version_id
       AND document_versions.document_id = documents.id
      WHERE documents.current_version_id IS NOT NULL
        AND document_versions.id IS NULL
      ORDER BY catalog_sources.source_key, documents.public_id
    `,
    (row) => `Document ${row.public_id} points to a missing or foreign current version`,
  );
  appendDocumentIssues(
    database,
    issues,
    'CURRENT_VERSION_NOT_MARKED_CURRENT',
    `
      SELECT catalog_sources.source_key, documents.public_id
      FROM documents
      INNER JOIN catalog_sources ON catalog_sources.id = documents.source_id
      INNER JOIN document_versions ON document_versions.id = documents.current_version_id
      WHERE document_versions.is_current <> 1
      ORDER BY catalog_sources.source_key, documents.public_id
    `,
    (row) => `Document ${row.public_id} points to a version not marked current`,
  );
  appendDocumentIssues(
    database,
    issues,
    'CURRENT_VERSION_WITHOUT_SECTIONS',
    `
      SELECT catalog_sources.source_key, documents.public_id
      FROM documents
      INNER JOIN catalog_sources ON catalog_sources.id = documents.source_id
      INNER JOIN document_versions ON document_versions.id = documents.current_version_id
      LEFT JOIN document_sections
        ON document_sections.document_version_id = document_versions.id
      GROUP BY catalog_sources.source_key, documents.public_id
      HAVING count(document_sections.id) = 0
      ORDER BY catalog_sources.source_key, documents.public_id
    `,
    (row) => `Current version for document ${row.public_id} has no sections`,
  );
  appendDocumentIssues(
    database,
    issues,
    'CURRENT_VERSION_FLAG_NOT_POINTED',
    `
      SELECT catalog_sources.source_key, documents.public_id
      FROM document_versions
      INNER JOIN documents ON documents.id = document_versions.document_id
      INNER JOIN catalog_sources ON catalog_sources.id = documents.source_id
      WHERE document_versions.is_current = 1
        AND documents.current_version_id IS NOT document_versions.id
      ORDER BY catalog_sources.source_key, documents.public_id
    `,
    (row) => `Version marked current for document ${row.public_id} is not the current pointer`,
  );

  appendSectionIssues(
    database,
    issues,
    'CURRENT_SECTION_MISSING_FROM_FTS',
    `
      SELECT
        catalog_sources.source_key,
        documents.public_id,
        document_sections.id AS section_id
      FROM document_sections
      INNER JOIN document_versions
        ON document_versions.id = document_sections.document_version_id
       AND document_versions.is_current = 1
      INNER JOIN documents
        ON documents.id = document_versions.document_id
       AND documents.current_version_id = document_versions.id
      INNER JOIN catalog_sources ON catalog_sources.id = documents.source_id
      LEFT JOIN document_section_fts ON document_section_fts.rowid = document_sections.id
      WHERE catalog_sources.enabled = 1
        AND documents.status = 'ACTIVE'
        AND document_section_fts.rowid IS NULL
      ORDER BY catalog_sources.source_key, documents.public_id, document_sections.id
    `,
    (row) => `Current section ${row.section_id} for document ${row.public_id} is missing from FTS`,
  );

  appendFtsPayloadMismatchIssues(database, issues);

  const orphanedFtsRows = database
    .prepare<[], { readonly section_id: number }>(
      `
      SELECT document_section_fts.rowid AS section_id
      FROM document_section_fts
      LEFT JOIN document_sections
        ON document_sections.id = document_section_fts.rowid
      LEFT JOIN document_versions
        ON document_versions.id = document_sections.document_version_id
      LEFT JOIN documents
        ON documents.id = document_versions.document_id
      LEFT JOIN catalog_sources
        ON catalog_sources.id = documents.source_id
      WHERE document_sections.id IS NULL
         OR document_versions.is_current <> 1
         OR documents.current_version_id IS NOT document_versions.id
         OR documents.status <> 'ACTIVE'
         OR catalog_sources.enabled <> 1
      ORDER BY document_section_fts.rowid
    `,
    )
    .all();
  for (const row of orphanedFtsRows) {
    issues.push({
      code: 'FTS_ENTRY_ORPHANED',
      message: `FTS row ${row.section_id} does not represent a current searchable section`,
      sectionId: row.section_id,
    });
  }

  return {
    sqliteIntegrityCheck,
    counts: {
      sources: count(database, 'SELECT count(*) AS count FROM catalog_sources'),
      enabledSources: count(
        database,
        'SELECT count(*) AS count FROM catalog_sources WHERE enabled = 1',
      ),
      documents: count(database, 'SELECT count(*) AS count FROM documents'),
      activeDocuments: count(
        database,
        "SELECT count(*) AS count FROM documents WHERE status = 'ACTIVE'",
      ),
      currentSections: count(
        database,
        `
          SELECT count(*) AS count
          FROM document_sections
          INNER JOIN document_versions
            ON document_versions.id = document_sections.document_version_id
           AND document_versions.is_current = 1
          INNER JOIN documents
            ON documents.id = document_versions.document_id
           AND documents.current_version_id = document_versions.id
        `,
      ),
      indexedSections: count(database, 'SELECT count(*) AS count FROM document_section_fts'),
    },
    issues,
  };
}

function appendFtsPayloadMismatchIssues(
  database: Database.Database,
  issues: CatalogIntegrityIssue[],
): void {
  try {
    database.exec(DROP_FTS_INTEGRITY_TEMP_TABLES_SQL);
    database.exec(`
      CREATE VIRTUAL TABLE temp.catalog_integrity_expected_fts USING fts5(
        section_id UNINDEXED,
        document_id UNINDEXED,
        source_key UNINDEXED,
        language UNINDEXED,
        title,
        heading,
        heading_path,
        content,
        tokenize = 'unicode61 remove_diacritics 2'
      );

      INSERT INTO temp.catalog_integrity_expected_fts(
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
       AND document_versions.is_current = 1
      INNER JOIN documents
        ON documents.id = document_versions.document_id
       AND documents.current_version_id = document_versions.id
      INNER JOIN catalog_sources ON catalog_sources.id = documents.source_id
      WHERE catalog_sources.enabled = 1
        AND documents.status = 'ACTIVE';

      CREATE VIRTUAL TABLE temp.catalog_integrity_actual_vocab
      USING fts5vocab(main, 'document_section_fts', 'instance');

      CREATE VIRTUAL TABLE temp.catalog_integrity_expected_vocab
      USING fts5vocab(temp, 'catalog_integrity_expected_fts', 'instance');
    `);

    const mismatchedSections = database
      .prepare<[], SectionIssueRow>(
        `
        WITH actual_only AS (
          SELECT term, doc, col, offset
          FROM temp.catalog_integrity_actual_vocab
          EXCEPT
          SELECT term, doc, col, offset
          FROM temp.catalog_integrity_expected_vocab
        ),
        expected_only AS (
          SELECT term, doc, col, offset
          FROM temp.catalog_integrity_expected_vocab
          EXCEPT
          SELECT term, doc, col, offset
          FROM temp.catalog_integrity_actual_vocab
        ),
        mismatched AS (
          SELECT doc AS section_id FROM actual_only
          UNION
          SELECT doc AS section_id FROM expected_only
        )
        SELECT
          catalog_sources.source_key,
          documents.public_id,
          document_sections.id AS section_id
        FROM mismatched
        INNER JOIN document_sections ON document_sections.id = mismatched.section_id
        INNER JOIN document_versions
          ON document_versions.id = document_sections.document_version_id
         AND document_versions.is_current = 1
        INNER JOIN documents
          ON documents.id = document_versions.document_id
         AND documents.current_version_id = document_versions.id
        INNER JOIN catalog_sources ON catalog_sources.id = documents.source_id
        INNER JOIN document_section_fts ON document_section_fts.rowid = document_sections.id
        WHERE catalog_sources.enabled = 1
          AND documents.status = 'ACTIVE'
        ORDER BY catalog_sources.source_key, documents.public_id, document_sections.id
      `,
      )
      .all();

    for (const row of mismatchedSections) {
      issues.push({
        code: 'FTS_ENTRY_CONTENT_MISMATCH',
        message: `FTS row ${row.section_id} for document ${row.public_id} has stale indexed content`,
        sourceKey: row.source_key,
        documentPublicId: row.public_id,
        sectionId: row.section_id,
      });
    }
  } catch {
    issues.push({
      code: 'FTS_ENTRY_CONTENT_MISMATCH',
      message: 'FTS semantic integrity verification could not complete',
    });
  } finally {
    try {
      database.exec(DROP_FTS_INTEGRITY_TEMP_TABLES_SQL);
    } catch {
      // Integrity verification is already fail-closed if the semantic check or its cleanup fails.
    }
  }
}

function count(database: Database.Database, sql: string): number {
  return database.prepare<[], CountRow>(sql).get()?.count ?? 0;
}

function appendDocumentIssues(
  database: Database.Database,
  issues: CatalogIntegrityIssue[],
  code: CatalogIntegrityIssue['code'],
  sql: string,
  message: (row: DocumentIssueRow) => string,
): void {
  for (const row of database.prepare<[], DocumentIssueRow>(sql).all()) {
    issues.push({
      code,
      message: message(row),
      sourceKey: row.source_key,
      documentPublicId: row.public_id,
    });
  }
}

function appendSectionIssues(
  database: Database.Database,
  issues: CatalogIntegrityIssue[],
  code: CatalogIntegrityIssue['code'],
  sql: string,
  message: (row: SectionIssueRow) => string,
): void {
  for (const row of database.prepare<[], SectionIssueRow>(sql).all()) {
    issues.push({
      code,
      message: message(row),
      sourceKey: row.source_key,
      documentPublicId: row.public_id,
      sectionId: row.section_id,
    });
  }
}
