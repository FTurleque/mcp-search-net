export const INSERT_CATALOG_SOURCE_SQL = `
  INSERT INTO catalog_sources (
    source_key, display_name, base_url, source_type, language,
    freshness_policy, sync_strategy, enabled, created_at, updated_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`;

export const SELECT_CATALOG_SOURCE_BY_KEY_SQL =
  'SELECT * FROM catalog_sources WHERE source_key = ?';

export const SELECT_CATALOG_SOURCES_SQL = 'SELECT * FROM catalog_sources ORDER BY source_key';

export const UPSERT_DOCUMENT_SQL = `
  INSERT INTO documents (
    public_id, source_id, canonical_url, stable_key, title, mime_type,
    language, status, first_seen_at, last_seen_at, created_at, updated_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(source_id, stable_key) DO UPDATE SET
    canonical_url = excluded.canonical_url,
    title = excluded.title,
    mime_type = excluded.mime_type,
    language = excluded.language,
    status = excluded.status,
    last_seen_at = excluded.last_seen_at,
    updated_at = excluded.updated_at
`;

export const SELECT_DOCUMENT_BY_PUBLIC_ID_SQL = 'SELECT * FROM documents WHERE public_id = ?';

export const SELECT_DOCUMENT_BY_SOURCE_AND_STABLE_KEY_SQL =
  'SELECT * FROM documents WHERE source_id = ? AND stable_key = ?';

export const SELECT_DOCUMENTS_SQL = 'SELECT * FROM documents ORDER BY source_id, stable_key';

export const CLEAR_CURRENT_DOCUMENT_VERSIONS_SQL =
  'UPDATE document_versions SET is_current = 0 WHERE document_id = ?';

export const UPSERT_DOCUMENT_VERSION_SQL = `
  INSERT INTO document_versions (
    document_id, version_label, content_hash, etag, last_modified,
    published_at, fetched_at, is_current, extraction_mode, content_type, metadata_json
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(document_id, content_hash) DO UPDATE SET
    version_label = excluded.version_label,
    etag = excluded.etag,
    last_modified = excluded.last_modified,
    published_at = excluded.published_at,
    fetched_at = excluded.fetched_at,
    is_current = excluded.is_current,
    extraction_mode = excluded.extraction_mode,
    content_type = excluded.content_type,
    metadata_json = excluded.metadata_json
`;

export const SELECT_DOCUMENT_VERSION_BY_HASH_SQL =
  'SELECT * FROM document_versions WHERE document_id = ? AND content_hash = ?';

export const SET_DOCUMENT_CURRENT_VERSION_SQL =
  'UPDATE documents SET current_version_id = ?, updated_at = ? WHERE id = ?';

export const DELETE_DOCUMENT_SECTIONS_SQL =
  'DELETE FROM document_sections WHERE document_version_id = ?';

export const INSERT_DOCUMENT_SECTION_SQL = `
  INSERT INTO document_sections (
    document_version_id, ordinal, heading, heading_path, heading_level, anchor,
    content, content_hash, character_count, token_count
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`;

export const SELECT_DOCUMENT_SECTIONS_SQL =
  'SELECT * FROM document_sections WHERE document_version_id = ? ORDER BY ordinal';
