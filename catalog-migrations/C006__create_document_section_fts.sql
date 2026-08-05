CREATE VIRTUAL TABLE document_section_fts USING fts5(
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
