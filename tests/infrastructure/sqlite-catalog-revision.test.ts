/* eslint-disable @typescript-eslint/no-deprecated -- low-level SQLite compatibility tests intentionally exercise legacy mutation paths */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';

import { SqliteCatalogRepository } from '../../src/infrastructure/catalog/sqlite-catalog-repository.js';

const roots: string[] = [];
const repositories: SqliteCatalogRepository[] = [];
const clock = { now: () => new Date(1_000) };

afterEach(() => {
  repositories.splice(0).forEach((repository) => repository.close());
  roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true }));
});

describe('SqliteCatalogRepository document revisions', () => {
  it('commits document, version, sections, FTS and current pointer atomically', async () => {
    const fixture = await createFixture();

    const revision = await fixture.repository.commitDocumentRevision(
      revisionInput('hash-v1', 'Atomic catalog content'),
    );

    expect(revision.document.currentVersionId).toBe(revision.version.id);
    await expect(
      fixture.repository.searchDocuments({ query: 'atomic catalog' }),
    ).resolves.toMatchObject([
      {
        document: { publicId: 'guide', currentVersionId: revision.version.id },
        section: { content: 'Atomic catalog content' },
      },
    ]);

    const database = new Database(fixture.path, { readonly: true });
    const ftsDefinition = database
      .prepare(
        "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'document_section_fts'",
      )
      .get() as { sql: string };
    database.close();
    expect(ftsDefinition.sql).toContain('contentless_delete = 1');
  });

  it('rolls back every revision write when section insertion fails, then recovers after reopen', async () => {
    const fixture = await createFixture();
    const first = await fixture.repository.commitDocumentRevision(
      revisionInput('hash-v1', 'Stable old content'),
    );
    const invalid = revisionInput('hash-v2', 'New incomplete content', [
      section(0, 'duplicate-one', 'First duplicate ordinal'),
      section(0, 'duplicate-two', 'Second duplicate ordinal'),
    ]);

    await expect(fixture.repository.commitDocumentRevision(invalid)).rejects.toThrow();

    const database = new Database(fixture.path, { readonly: true });
    expect(
      database.prepare('SELECT current_version_id FROM documents WHERE public_id = ?').get('guide'),
    ).toEqual({ current_version_id: first.version.id });
    expect(database.prepare('SELECT count(*) AS count FROM document_versions').get()).toEqual({
      count: 1,
    });
    expect(database.prepare('SELECT count(*) AS count FROM document_sections').get()).toEqual({
      count: 1,
    });
    expect(database.prepare('SELECT count(*) AS count FROM document_section_fts').get()).toEqual({
      count: 1,
    });
    database.close();

    fixture.repository.close();
    repositories.splice(repositories.indexOf(fixture.repository), 1);
    const reopened = new SqliteCatalogRepository(fixture.path, clock);
    repositories.push(reopened);
    const recovered = await reopened.commitDocumentRevision(
      revisionInput('hash-v2', 'Recovered complete content'),
    );

    expect(recovered.document.currentVersionId).toBe(recovered.version.id);
    await expect(reopened.searchDocuments({ query: 'recovered complete' })).resolves.toHaveLength(
      1,
    );
    await expect(reopened.searchDocuments({ query: 'stable old' })).resolves.toHaveLength(0);
  });

  it('rolls back revision, alias and event writes when observation persistence fails', async () => {
    const fixture = await createFixture();
    const first = await fixture.repository.commitDocumentRevision(
      revisionInput('hash-v1', 'Stable content before observation failure'),
    );

    await expect(
      fixture.repository.commitDocumentRevision(
        revisionInput('hash-v2', 'Content that must not become current'),
        {
          syncRunId: 999_999,
          aliases: [{ url: 'https://example.test/old-guide', aliasType: 'OLD_URL' }],
          events: [{ eventType: 'CONTENT_HASH_CHANGED', detailsJson: '{}' }],
        },
      ),
    ).rejects.toThrow(/FOREIGN KEY/u);

    const database = new Database(fixture.path, { readonly: true });
    expect(
      database.prepare('SELECT current_version_id FROM documents WHERE public_id = ?').get('guide'),
    ).toEqual({ current_version_id: first.version.id });
    expect(database.prepare('SELECT count(*) AS count FROM document_versions').get()).toEqual({
      count: 1,
    });
    expect(database.prepare('SELECT count(*) AS count FROM document_sections').get()).toEqual({
      count: 1,
    });
    expect(database.prepare('SELECT count(*) AS count FROM document_section_fts').get()).toEqual({
      count: 1,
    });
    expect(database.prepare('SELECT count(*) AS count FROM document_aliases').get()).toEqual({
      count: 0,
    });
    expect(database.prepare('SELECT count(*) AS count FROM staleness_events').get()).toEqual({
      count: 0,
    });
    database.close();

    await expect(
      fixture.repository.searchDocuments({ query: 'stable content' }),
    ).resolves.toHaveLength(1);
    await expect(
      fixture.repository.searchDocuments({ query: 'must not become' }),
    ).resolves.toHaveLength(0);
  });

  it('rolls back document and version writes when FTS indexing fails', async () => {
    const fixture = await createFixture();
    const first = await fixture.repository.commitDocumentRevision(
      revisionInput('hash-v1', 'Stable before index failure'),
    );
    const sabotage = new Database(fixture.path);
    sabotage.exec('DROP TABLE document_section_fts;');
    sabotage.close();

    await expect(
      fixture.repository.commitDocumentRevision(
        revisionInput('hash-v2', 'This revision must roll back'),
      ),
    ).rejects.toThrow(/document_section_fts/u);

    const database = new Database(fixture.path, { readonly: true });
    expect(
      database.prepare('SELECT current_version_id FROM documents WHERE public_id = ?').get('guide'),
    ).toEqual({ current_version_id: first.version.id });
    expect(database.prepare('SELECT count(*) AS count FROM document_versions').get()).toEqual({
      count: 1,
    });
    expect(database.prepare('SELECT count(*) AS count FROM document_sections').get()).toEqual({
      count: 1,
    });
    database.close();
  });

  it('rejects a current pointer to a version owned by another document', async () => {
    const fixture = await createFixture();
    const revision = await fixture.repository.commitDocumentRevision(
      revisionInput('hash-v1', 'Guarded pointer'),
    );
    const database = new Database(fixture.path);
    database
      .prepare(
        `INSERT INTO documents(
          public_id, source_id, canonical_url, stable_key, title, mime_type,
          language, status, first_seen_at, last_seen_at, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        'other',
        fixture.sourceId,
        'https://example.test/other',
        'other',
        'Other',
        'text/plain',
        'en',
        'ACTIVE',
        1,
        1,
        1,
        1,
      );

    expect(() =>
      database
        .prepare('UPDATE documents SET current_version_id = ? WHERE public_id = ?')
        .run(revision.version.id, 'other'),
    ).toThrow(/DOCUMENT_CURRENT_VERSION_INVALID/u);
    database.close();
  });

  it('verify detects missing and orphaned FTS rows while SQLite remains structurally sound', async () => {
    const fixture = await createFixture();
    const revision = await fixture.repository.commitDocumentRevision(
      revisionInput('hash-v1', 'Indexed content'),
    );
    await expect(fixture.repository.verifyIntegrity()).resolves.toMatchObject({
      sqliteIntegrityCheck: 'ok',
      counts: { currentSections: 1, indexedSections: 1 },
      issues: [],
    });

    const database = new Database(fixture.path);
    database
      .prepare('DELETE FROM document_section_fts WHERE rowid = ?')
      .run(revision.sections[0]?.id);
    database
      .prepare(
        `INSERT INTO document_section_fts(
          rowid, section_id, document_id, source_key, language,
          title, heading, heading_path, content
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(999, 999, 999, 'sample', 'en', 'Orphan', 'Orphan', 'Orphan', 'orphan');
    database.close();

    const report = await fixture.repository.verifyIntegrity();
    expect(report.sqliteIntegrityCheck).toBe('ok');
    expect(report.counts).toMatchObject({ currentSections: 1, indexedSections: 1 });
    expect(report.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'CURRENT_SECTION_MISSING_FROM_FTS',
          sectionId: revision.sections[0]?.id,
        }),
        expect.objectContaining({ code: 'FTS_ENTRY_ORPHANED', sectionId: 999 }),
      ]),
    );
  });

  it('verify detects active documents without a usable sectioned current version', async () => {
    const fixture = await createFixture();
    const unversioned = await fixture.repository.upsertDocument({
      publicId: 'unversioned',
      sourceId: fixture.sourceId,
      canonicalUrl: 'https://example.test/unversioned',
      stableKey: 'unversioned',
      title: 'Unversioned',
      mimeType: 'text/plain',
      language: 'en',
      status: 'ACTIVE',
    });
    const empty = await fixture.repository.upsertDocument({
      publicId: 'empty',
      sourceId: fixture.sourceId,
      canonicalUrl: 'https://example.test/empty',
      stableKey: 'empty',
      title: 'Empty',
      mimeType: 'text/plain',
      language: 'en',
      status: 'ACTIVE',
    });
    const staged = await fixture.repository.addDocumentVersion({
      documentId: empty.id,
      contentHash: 'empty-hash',
      isCurrent: true,
      extractionMode: 'static',
      contentType: 'text/plain',
      metadataJson: '{}',
    });
    expect(staged.isCurrent).toBe(false);

    const database = new Database(fixture.path);
    database.prepare('UPDATE document_versions SET is_current = 1 WHERE id = ?').run(staged.id);
    database
      .prepare('UPDATE documents SET current_version_id = ? WHERE id = ?')
      .run(staged.id, empty.id);
    database.close();

    const report = await fixture.repository.verifyIntegrity();

    expect(unversioned.currentVersionId).toBeUndefined();
    expect(report.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'ACTIVE_DOCUMENT_WITHOUT_CURRENT_VERSION',
          documentPublicId: 'unversioned',
        }),
        expect.objectContaining({
          code: 'CURRENT_VERSION_WITHOUT_SECTIONS',
          documentPublicId: 'empty',
        }),
      ]),
    );
  });

  it('keeps FTS coherent when document metadata or searchability changes without new content', async () => {
    const fixture = await createFixture();
    await fixture.repository.commitDocumentRevision(
      revisionInput('hash-v1', 'Unchanged searchable body'),
    );

    await fixture.repository.upsertDocument({
      ...revisionInput('hash-v1', 'ignored').document,
      title: 'Removed guide',
      status: 'REMOVED',
    });

    await expect(fixture.repository.searchDocuments({ query: 'unchanged' })).resolves.toHaveLength(
      0,
    );
    await expect(fixture.repository.verifyIntegrity()).resolves.toMatchObject({
      counts: { currentSections: 1, indexedSections: 0 },
      issues: [],
    });

    await fixture.repository.upsertDocument({
      ...revisionInput('hash-v1', 'ignored').document,
      title: 'Renewed guide title',
      status: 'ACTIVE',
    });

    await expect(fixture.repository.searchDocuments({ query: 'renewed' })).resolves.toHaveLength(1);
    await expect(fixture.repository.verifyIntegrity()).resolves.toMatchObject({
      counts: { currentSections: 1, indexedSections: 1 },
      issues: [],
    });
  });
});

async function createFixture() {
  const root = mkdtempSync(join(tmpdir(), 'catalog-revision-'));
  roots.push(root);
  const path = join(root, 'catalog.db');
  const repository = new SqliteCatalogRepository(path, clock);
  repositories.push(repository);
  const source = await repository.addSource({
    sourceKey: 'sample',
    displayName: 'Sample',
    baseUrl: 'https://example.test/',
    sourceType: 'documentation',
    language: 'en',
    freshnessPolicy: 'manual',
    syncStrategy: 'manual',
    enabled: true,
  });
  return { repository, path, sourceId: source.id };
}

function revisionInput(
  contentHash: string,
  content: string,
  sections = [section(0, `section-${contentHash}`, content)],
) {
  return {
    document: {
      publicId: 'guide',
      sourceId: 1,
      canonicalUrl: 'https://example.test/guide',
      stableKey: 'guide',
      title: 'Guide',
      mimeType: 'text/plain',
      language: 'en',
      status: 'ACTIVE' as const,
    },
    version: {
      contentHash,
      extractionMode: 'static' as const,
      contentType: 'text/plain',
      metadataJson: '{}',
    },
    sections,
  };
}

function section(ordinal: number, contentHash: string, content: string) {
  return {
    ordinal,
    heading: 'Guide',
    headingPath: 'Guide',
    headingLevel: 1,
    anchor: 'guide',
    content,
    contentHash,
    characterCount: content.length,
    tokenCount: content.split(/\s+/u).length,
  };
}
