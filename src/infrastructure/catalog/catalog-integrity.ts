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

  appendSectionIssues(
    database,
    issues,
    'FTS_ENTRY_CONTENT_MISMATCH',
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
      INNER JOIN document_section_fts ON document_section_fts.rowid = document_sections.id
      WHERE catalog_sources.enabled = 1
        AND documents.status = 'ACTIVE'
        AND (
          document_section_fts.section_id IS NOT document_sections.id
          OR document_section_fts.document_id IS NOT documents.id
          OR document_section_fts.source_key IS NOT catalog_sources.source_key
          OR document_section_fts.language IS NOT documents.language
          OR document_section_fts.title IS NOT documents.title
          OR document_section_fts.heading IS NOT coalesce(document_sections.heading, '')
          OR document_section_fts.heading_path IS NOT coalesce(document_sections.heading_path, '')
          OR document_section_fts.content IS NOT document_sections.content
        )
      ORDER BY catalog_sources.source_key, documents.public_id, document_sections.id
    `,
    (row) =>
      `FTS row ${row.section_id} for document ${row.public_id} does not match its current searchable section`,
  );

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
