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

export const SELECT_CURRENT_DOCUMENT_SECTIONS_SQL = `
  SELECT
    catalog_sources.id AS source_id,
    catalog_sources.source_key AS source_source_key,
    catalog_sources.display_name AS source_display_name,
    catalog_sources.base_url AS source_base_url,
    catalog_sources.source_type AS source_source_type,
    catalog_sources.language AS source_language,
    catalog_sources.freshness_policy AS source_freshness_policy,
    catalog_sources.sync_strategy AS source_sync_strategy,
    catalog_sources.enabled AS source_enabled,
    catalog_sources.created_at AS source_created_at,
    catalog_sources.updated_at AS source_updated_at,

    documents.id AS document_id,
    documents.public_id AS document_public_id,
    documents.source_id AS document_source_id,
    documents.canonical_url AS document_canonical_url,
    documents.stable_key AS document_stable_key,
    documents.title AS document_title,
    documents.mime_type AS document_mime_type,
    documents.language AS document_language,
    documents.status AS document_status,
    documents.current_version_id AS document_current_version_id,
    documents.first_seen_at AS document_first_seen_at,
    documents.last_seen_at AS document_last_seen_at,
    documents.created_at AS document_created_at,
    documents.updated_at AS document_updated_at,

    document_sections.id AS section_id,
    document_sections.document_version_id AS section_document_version_id,
    document_sections.ordinal AS section_ordinal,
    document_sections.heading AS section_heading,
    document_sections.heading_path AS section_heading_path,
    document_sections.heading_level AS section_heading_level,
    document_sections.anchor AS section_anchor,
    document_sections.content AS section_content,
    document_sections.content_hash AS section_content_hash,
    document_sections.character_count AS section_character_count,
    document_sections.token_count AS section_token_count
  FROM document_sections
  INNER JOIN document_versions
    ON document_versions.id = document_sections.document_version_id
   AND document_versions.is_current = 1
  INNER JOIN documents
    ON documents.id = document_versions.document_id
   AND documents.current_version_id = document_versions.id
  INNER JOIN catalog_sources
    ON catalog_sources.id = documents.source_id
  ORDER BY catalog_sources.source_key, documents.title COLLATE NOCASE, document_sections.ordinal
`;

export const DELETE_DOCUMENT_SECTION_FTS_SQL = 'DELETE FROM document_section_fts';

export const INSERT_CURRENT_DOCUMENT_SECTIONS_FTS_SQL = `
  INSERT INTO document_section_fts(
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
  INNER JOIN catalog_sources
    ON catalog_sources.id = documents.source_id
  WHERE catalog_sources.enabled = 1
    AND documents.status = 'ACTIVE'
`;

export const COUNT_DOCUMENT_SECTION_FTS_SQL = 'SELECT count(*) AS count FROM document_section_fts';

export const SEARCH_CURRENT_DOCUMENT_SECTIONS_FTS_SQL = `
  SELECT
    catalog_sources.id AS source_id,
    catalog_sources.source_key AS source_source_key,
    catalog_sources.display_name AS source_display_name,
    catalog_sources.base_url AS source_base_url,
    catalog_sources.source_type AS source_source_type,
    catalog_sources.language AS source_language,
    catalog_sources.freshness_policy AS source_freshness_policy,
    catalog_sources.sync_strategy AS source_sync_strategy,
    catalog_sources.enabled AS source_enabled,
    catalog_sources.created_at AS source_created_at,
    catalog_sources.updated_at AS source_updated_at,

    documents.id AS document_id,
    documents.public_id AS document_public_id,
    documents.source_id AS document_source_id,
    documents.canonical_url AS document_canonical_url,
    documents.stable_key AS document_stable_key,
    documents.title AS document_title,
    documents.mime_type AS document_mime_type,
    documents.language AS document_language,
    documents.status AS document_status,
    documents.current_version_id AS document_current_version_id,
    documents.first_seen_at AS document_first_seen_at,
    documents.last_seen_at AS document_last_seen_at,
    documents.created_at AS document_created_at,
    documents.updated_at AS document_updated_at,

    document_sections.id AS section_id,
    document_sections.document_version_id AS section_document_version_id,
    document_sections.ordinal AS section_ordinal,
    document_sections.heading AS section_heading,
    document_sections.heading_path AS section_heading_path,
    document_sections.heading_level AS section_heading_level,
    document_sections.anchor AS section_anchor,
    document_sections.content AS section_content,
    document_sections.content_hash AS section_content_hash,
    document_sections.character_count AS section_character_count,
    document_sections.token_count AS section_token_count,

    CASE
      WHEN lower(documents.title) LIKE ? ESCAPE '\\' THEN 4
      WHEN lower(document_sections.heading) LIKE ? ESCAPE '\\' THEN 3
      WHEN lower(document_sections.heading_path) LIKE ? ESCAPE '\\' THEN 2
      ELSE 1
    END AS score,
    bm25(document_section_fts) AS rank
  FROM document_section_fts
  INNER JOIN document_sections
    ON document_sections.id = document_section_fts.section_id
  INNER JOIN document_versions
    ON document_versions.id = document_sections.document_version_id
   AND document_versions.is_current = 1
  INNER JOIN documents
    ON documents.id = document_versions.document_id
   AND documents.current_version_id = document_versions.id
  INNER JOIN catalog_sources
    ON catalog_sources.id = documents.source_id
  WHERE document_section_fts MATCH ?
    AND catalog_sources.enabled = 1
    AND documents.status = 'ACTIVE'
    AND (? IS NULL OR catalog_sources.source_key = ?)
    AND (? IS NULL OR documents.language = ?)
  ORDER BY rank ASC, score DESC, documents.title COLLATE NOCASE, document_sections.ordinal
  LIMIT ?
`;

export const SEARCH_CURRENT_DOCUMENT_SECTIONS_SQL = `
  SELECT
    catalog_sources.id AS source_id,
    catalog_sources.source_key AS source_source_key,
    catalog_sources.display_name AS source_display_name,
    catalog_sources.base_url AS source_base_url,
    catalog_sources.source_type AS source_source_type,
    catalog_sources.language AS source_language,
    catalog_sources.freshness_policy AS source_freshness_policy,
    catalog_sources.sync_strategy AS source_sync_strategy,
    catalog_sources.enabled AS source_enabled,
    catalog_sources.created_at AS source_created_at,
    catalog_sources.updated_at AS source_updated_at,

    documents.id AS document_id,
    documents.public_id AS document_public_id,
    documents.source_id AS document_source_id,
    documents.canonical_url AS document_canonical_url,
    documents.stable_key AS document_stable_key,
    documents.title AS document_title,
    documents.mime_type AS document_mime_type,
    documents.language AS document_language,
    documents.status AS document_status,
    documents.current_version_id AS document_current_version_id,
    documents.first_seen_at AS document_first_seen_at,
    documents.last_seen_at AS document_last_seen_at,
    documents.created_at AS document_created_at,
    documents.updated_at AS document_updated_at,

    document_sections.id AS section_id,
    document_sections.document_version_id AS section_document_version_id,
    document_sections.ordinal AS section_ordinal,
    document_sections.heading AS section_heading,
    document_sections.heading_path AS section_heading_path,
    document_sections.heading_level AS section_heading_level,
    document_sections.anchor AS section_anchor,
    document_sections.content AS section_content,
    document_sections.content_hash AS section_content_hash,
    document_sections.character_count AS section_character_count,
    document_sections.token_count AS section_token_count,

    CASE
      WHEN lower(documents.title) LIKE ? ESCAPE '\\' THEN 4
      WHEN lower(document_sections.heading) LIKE ? ESCAPE '\\' THEN 3
      WHEN lower(document_sections.heading_path) LIKE ? ESCAPE '\\' THEN 2
      ELSE 1
    END AS score
  FROM document_sections
  INNER JOIN document_versions
    ON document_versions.id = document_sections.document_version_id
   AND document_versions.is_current = 1
  INNER JOIN documents
    ON documents.id = document_versions.document_id
   AND documents.current_version_id = document_versions.id
  INNER JOIN catalog_sources
    ON catalog_sources.id = documents.source_id
  WHERE catalog_sources.enabled = 1
    AND documents.status = 'ACTIVE'
    AND (? IS NULL OR catalog_sources.source_key = ?)
    AND (? IS NULL OR documents.language = ?)
    AND (
      lower(documents.title) LIKE ? ESCAPE '\\'
      OR lower(document_sections.heading) LIKE ? ESCAPE '\\'
      OR lower(document_sections.heading_path) LIKE ? ESCAPE '\\'
      OR lower(document_sections.content) LIKE ? ESCAPE '\\'
    )
  ORDER BY score DESC, documents.title COLLATE NOCASE, document_sections.ordinal
  LIMIT ?
`;
