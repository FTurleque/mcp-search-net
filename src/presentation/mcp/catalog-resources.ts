import { ResourceTemplate, type McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import {
  MAX_CATALOG_PAGE_OFFSET,
  type CatalogPage,
  type CatalogRepository,
} from '../../application/ports/catalog-repository.js';
import { InvalidArgumentError, ResponseTooLargeError } from '../../domain/errors/domain-errors.js';
import type {
  CatalogCurrentDocumentSection,
  CatalogDocument,
  CatalogDocumentEntry,
  CatalogSource,
  DocumentSection,
  DocumentVersion,
} from '../../domain/models/catalog.js';
import {
  EXTERNAL_CONTENT_SAFETY_NOTICE,
  EXTERNAL_CONTENT_TRUST,
} from '../../domain/models/tool-response.js';
import {
  countUnicodeCharacters,
  MAX_CATALOG_MIME_TYPE_CHARACTERS,
  MAX_CATALOG_STABLE_KEY_CHARACTERS,
  MAX_CATALOG_URL_CHARACTERS,
  MAX_CATALOG_VERSION_LABEL_CHARACTERS,
  MAX_EXTERNAL_ANCHOR_CHARACTERS,
  MAX_EXTERNAL_DOCUMENT_PUBLIC_ID_CHARACTERS,
  MAX_EXTERNAL_HEADING_CHARACTERS,
  MAX_EXTERNAL_HEADING_PATH_CHARACTERS,
  MAX_EXTERNAL_LANGUAGE_CHARACTERS,
  MAX_EXTERNAL_SOURCE_KEY_CHARACTERS,
  MAX_EXTERNAL_SOURCE_NAME_CHARACTERS,
  MAX_EXTERNAL_TITLE_CHARACTERS,
  truncateUnicode,
} from '../../domain/services/bounded-text.js';

const RESOURCE_MIME_TYPE = 'application/json';
const CATALOG_RESOURCE_PAGE_LIMIT = 20;
const MAX_CATALOG_RESOURCE_CHARACTERS = 24_000;
const MAX_RESOURCE_SECTION_CONTENT_CHARACTERS = 8_000;
const MAX_RESOURCE_METADATA_CHARACTERS = 2_000;
const MAX_RESOURCE_METADATA_FIELD_CHARACTERS = 1_024;

const CATALOG_RESOURCE_URIS = {
  catalog: 'mcp-search-net://catalog',
  sources: 'mcp-search-net://sources',
  sourcesPage: 'mcp-search-net://sources/page/{offset}',
  source: 'mcp-search-net://sources/{sourceId}',
  documents: 'mcp-search-net://documents',
  documentsPage: 'mcp-search-net://documents/page/{offset}',
  document: 'mcp-search-net://documents/{documentId}',
  documentVersions: 'mcp-search-net://documents/{documentId}/versions',
  documentVersionsPage: 'mcp-search-net://documents/{documentId}/versions/page/{offset}',
  documentVersion: 'mcp-search-net://documents/{documentId}/versions/{versionId}',
  sections: 'mcp-search-net://sections',
  sectionsPage: 'mcp-search-net://sections/page/{offset}',
  section: 'mcp-search-net://sections/{sectionId}',
} as const;

export function registerCatalogResources(server: McpServer, repository: CatalogRepository): void {
  server.registerResource(
    'catalog',
    CATALOG_RESOURCE_URIS.catalog,
    {
      title: 'Catalog summary',
      description: 'Read-only summary of the local V2 catalog.',
      mimeType: RESOURCE_MIME_TYPE,
    },
    async (uri) => jsonResource(uri, await createCatalogSummary(repository)),
  );

  server.registerResource(
    'catalog-sources',
    CATALOG_RESOURCE_URIS.sources,
    {
      title: 'Catalog sources',
      description: 'Read-only first page of configured catalog sources.',
      mimeType: RESOURCE_MIME_TYPE,
    },
    async (uri) => jsonResource(uri, await createSourcesResource(repository)),
  );

  server.registerResource(
    'catalog-sources-page',
    new ResourceTemplate(CATALOG_RESOURCE_URIS.sourcesPage, { list: undefined }),
    {
      title: 'Catalog sources page',
      description: 'Read-only bounded page of catalog sources by stable offset.',
      mimeType: RESOURCE_MIME_TYPE,
    },
    async (uri) =>
      jsonResource(uri, await createSourcesResource(repository, parsePageOffset(uri, 'sources'))),
  );

  server.registerResource(
    'catalog-source',
    new ResourceTemplate(CATALOG_RESOURCE_URIS.source, { list: undefined }),
    {
      title: 'Catalog source',
      description: 'Read-only catalog source details by numeric source id.',
      mimeType: RESOURCE_MIME_TYPE,
    },
    async (uri) => jsonResource(uri, await createSourceResource(repository, uri)),
  );

  server.registerResource(
    'catalog-documents',
    CATALOG_RESOURCE_URIS.documents,
    {
      title: 'Catalog documents',
      description: 'Read-only first page of catalog documents.',
      mimeType: RESOURCE_MIME_TYPE,
    },
    async (uri) => jsonResource(uri, await createDocumentsResource(repository)),
  );

  server.registerResource(
    'catalog-documents-page',
    new ResourceTemplate(CATALOG_RESOURCE_URIS.documentsPage, { list: undefined }),
    {
      title: 'Catalog documents page',
      description: 'Read-only bounded page of catalog documents by stable offset.',
      mimeType: RESOURCE_MIME_TYPE,
    },
    async (uri) =>
      jsonResource(
        uri,
        await createDocumentsResource(repository, parsePageOffset(uri, 'documents')),
      ),
  );

  server.registerResource(
    'catalog-document',
    new ResourceTemplate(CATALOG_RESOURCE_URIS.document, { list: undefined }),
    {
      title: 'Catalog document',
      description: 'Read-only catalog document details by numeric document id.',
      mimeType: RESOURCE_MIME_TYPE,
    },
    async (uri) => jsonResource(uri, await createDocumentResource(repository, uri)),
  );

  server.registerResource(
    'catalog-document-versions',
    new ResourceTemplate(CATALOG_RESOURCE_URIS.documentVersions, { list: undefined }),
    {
      title: 'Catalog document versions',
      description: 'Read-only historical version list for one catalog document.',
      mimeType: RESOURCE_MIME_TYPE,
    },
    async (uri) => jsonResource(uri, await createDocumentVersionsResource(repository, uri)),
  );

  server.registerResource(
    'catalog-document-version',
    new ResourceTemplate(CATALOG_RESOURCE_URIS.documentVersion, { list: undefined }),
    {
      title: 'Catalog document version',
      description: 'Read-only catalog document version details by numeric version id.',
      mimeType: RESOURCE_MIME_TYPE,
    },
    async (uri) => jsonResource(uri, await createDocumentVersionResource(repository, uri)),
  );

  server.registerResource(
    'catalog-document-versions-page',
    new ResourceTemplate(CATALOG_RESOURCE_URIS.documentVersionsPage, { list: undefined }),
    {
      title: 'Catalog document versions page',
      description: 'Read-only bounded version history page for one catalog document.',
      mimeType: RESOURCE_MIME_TYPE,
    },
    async (uri) =>
      jsonResource(
        uri,
        await createDocumentVersionsResource(repository, uri, parsePageOffset(uri, 'versions')),
      ),
  );

  server.registerResource(
    'catalog-sections',
    CATALOG_RESOURCE_URIS.sections,
    {
      title: 'Catalog sections',
      description: 'Read-only first compact page of current catalog document sections.',
      mimeType: RESOURCE_MIME_TYPE,
    },
    async (uri) => jsonResource(uri, await createSectionsResource(repository)),
  );

  server.registerResource(
    'catalog-sections-page',
    new ResourceTemplate(CATALOG_RESOURCE_URIS.sectionsPage, { list: undefined }),
    {
      title: 'Catalog sections page',
      description: 'Read-only bounded compact page of current catalog sections.',
      mimeType: RESOURCE_MIME_TYPE,
    },
    async (uri) =>
      jsonResource(uri, await createSectionsResource(repository, parsePageOffset(uri, 'sections'))),
  );

  server.registerResource(
    'catalog-section',
    new ResourceTemplate(CATALOG_RESOURCE_URIS.section, { list: undefined }),
    {
      title: 'Catalog section',
      description: 'Read-only current catalog section details by numeric section id.',
      mimeType: RESOURCE_MIME_TYPE,
    },
    async (uri) => jsonResource(uri, await createSectionResource(repository, uri)),
  );
}

async function createCatalogSummary(repository: CatalogRepository) {
  const [sources, enabledSources, documents, activeDocuments, currentSections] = await Promise.all([
    repository.countSources(),
    repository.countSources(true),
    repository.countDocuments(),
    repository.countDocuments({ status: 'ACTIVE' }),
    repository.countCurrentDocumentSections(),
  ]);

  return {
    schemaVersion: '1.0',
    resources: Object.values(CATALOG_RESOURCE_URIS),
    budgets: {
      pageLimit: CATALOG_RESOURCE_PAGE_LIMIT,
      maxResourceCharacters: MAX_CATALOG_RESOURCE_CHARACTERS,
      maxDetailedSectionCharacters: MAX_RESOURCE_SECTION_CONTENT_CHARACTERS,
    },
    counts: {
      sources,
      enabledSources,
      documents,
      activeDocuments,
      currentSections,
    },
  };
}

async function createSourcesResource(repository: CatalogRepository, offset = 0) {
  const page = await repository.listSourcesPage({ offset, limit: CATALOG_RESOURCE_PAGE_LIMIT });
  return {
    schemaVersion: '1.0',
    ...paginationData(page, CATALOG_RESOURCE_URIS.sources),
    sources: page.items.map(toResourceSource),
  };
}

async function createSourceResource(repository: CatalogRepository, uri: URL) {
  const sourceId = parseNumericResourceId(uri, 'sources');
  const source = await repository.getSourceById(sourceId);
  return {
    schemaVersion: '1.0',
    sourceId,
    found: source !== undefined,
    source: source === undefined ? null : toResourceSource(source),
  };
}

async function createDocumentsResource(repository: CatalogRepository, offset = 0) {
  const page = await repository.listDocumentsPage({ offset, limit: CATALOG_RESOURCE_PAGE_LIMIT });
  return {
    schemaVersion: '1.0',
    ...paginationData(page, CATALOG_RESOURCE_URIS.documents),
    documents: page.items.map(toResourceDocumentEntry),
  };
}

async function createDocumentResource(repository: CatalogRepository, uri: URL) {
  const documentId = parseNumericResourceId(uri, 'documents');
  const document = await repository.getDocumentById(documentId);
  return {
    schemaVersion: '1.0',
    documentId,
    found: document !== undefined,
    document: document === undefined ? null : toResourceDocument(document),
  };
}

async function createDocumentVersionsResource(repository: CatalogRepository, uri: URL, offset = 0) {
  const documentId = parseNumericResourceId(uri, 'documents');
  const page = await repository.listDocumentVersionsPage(documentId, {
    offset,
    limit: CATALOG_RESOURCE_PAGE_LIMIT,
  });
  return {
    schemaVersion: '1.0',
    documentId,
    available: true,
    ...paginationData(page, `mcp-search-net://documents/${documentId}/versions`),
    versions: page.items.map(toResourceDocumentVersion),
  };
}

async function createDocumentVersionResource(repository: CatalogRepository, uri: URL) {
  const { documentId, versionId } = parseDocumentVersionResourceIds(uri);
  const getDocumentVersion = repository.getDocumentVersion;
  if (getDocumentVersion === undefined) {
    return {
      schemaVersion: '1.0',
      documentId,
      versionId,
      available: false,
      found: false,
      version: null,
    };
  }
  const version = await getDocumentVersion.call(repository, documentId, versionId);
  return {
    schemaVersion: '1.0',
    documentId,
    versionId,
    available: true,
    found: version !== undefined,
    version: version === undefined ? null : toResourceDocumentVersion(version),
  };
}

async function createSectionsResource(repository: CatalogRepository, offset = 0) {
  const page = await repository.listCurrentDocumentSectionsPage({
    offset,
    limit: CATALOG_RESOURCE_PAGE_LIMIT,
  });
  return {
    schemaVersion: '1.0',
    compact: true,
    ...paginationData(page, CATALOG_RESOURCE_URIS.sections),
    sections: page.items.map(toCompactSectionEntry),
  };
}

async function createSectionResource(repository: CatalogRepository, uri: URL) {
  const sectionId = parseNumericResourceId(uri, 'sections');
  const section = await repository.getCurrentDocumentSectionById(sectionId);
  return {
    schemaVersion: '1.0',
    sectionId,
    found: section !== undefined,
    entry: section === undefined ? null : toResourceSectionEntry(section),
  };
}

function jsonResource(uri: URL, value: unknown) {
  const text = JSON.stringify(withContentTrust(value), null, 2);
  if (countUnicodeCharacters(text) > MAX_CATALOG_RESOURCE_CHARACTERS) {
    throw new ResponseTooLargeError('The catalog resource exceeds its response budget');
  }
  return {
    contents: [
      {
        uri: uri.href,
        mimeType: RESOURCE_MIME_TYPE,
        text,
      },
    ],
  };
}

function withContentTrust(value: unknown): Readonly<Record<string, unknown>> {
  const data =
    value !== null && typeof value === 'object' && !Array.isArray(value)
      ? (value as Readonly<Record<string, unknown>>)
      : { data: value };
  return {
    ...data,
    contentTrust: EXTERNAL_CONTENT_TRUST,
    contentSafetyNotice: EXTERNAL_CONTENT_SAFETY_NOTICE,
  };
}

function paginationData<T>(page: CatalogPage<T>, collectionUri: string) {
  const nextOffset =
    page.offset + page.items.length < page.total ? page.offset + page.items.length : null;
  return {
    bounded: true,
    count: page.items.length,
    total: page.total,
    offset: page.offset,
    limit: page.limit,
    nextOffset,
    nextUri: nextOffset === null ? null : `${collectionUri}/page/${nextOffset}`,
  };
}

function toResourceSource(source: CatalogSource) {
  return {
    id: source.id,
    sourceKey: boundedResourceText(source.sourceKey, MAX_EXTERNAL_SOURCE_KEY_CHARACTERS),
    displayName: boundedResourceText(source.displayName, MAX_EXTERNAL_SOURCE_NAME_CHARACTERS),
    baseUrl: boundedResourceText(source.baseUrl, MAX_CATALOG_URL_CHARACTERS),
    sourceType: source.sourceType,
    language: boundedResourceText(source.language, MAX_EXTERNAL_LANGUAGE_CHARACTERS),
    freshnessPolicy: source.freshnessPolicy,
    syncStrategy: source.syncStrategy,
    enabled: source.enabled,
    createdAt: source.createdAt.toISOString(),
    updatedAt: source.updatedAt.toISOString(),
  };
}

function toResourceDocument(document: CatalogDocument) {
  return {
    id: document.id,
    publicId: boundedResourceText(document.publicId, MAX_EXTERNAL_DOCUMENT_PUBLIC_ID_CHARACTERS),
    sourceId: document.sourceId,
    canonicalUrl: boundedResourceText(document.canonicalUrl, MAX_CATALOG_URL_CHARACTERS),
    stableKey: boundedResourceText(document.stableKey, MAX_CATALOG_STABLE_KEY_CHARACTERS),
    title: boundedResourceText(document.title, MAX_EXTERNAL_TITLE_CHARACTERS),
    mimeType: boundedResourceText(document.mimeType, MAX_CATALOG_MIME_TYPE_CHARACTERS),
    language: boundedResourceText(document.language, MAX_EXTERNAL_LANGUAGE_CHARACTERS),
    status: document.status,
    currentVersionId: document.currentVersionId ?? null,
    firstSeenAt: document.firstSeenAt.toISOString(),
    lastSeenAt: document.lastSeenAt.toISOString(),
    createdAt: document.createdAt.toISOString(),
    updatedAt: document.updatedAt.toISOString(),
  };
}

function toResourceDocumentEntry(entry: CatalogDocumentEntry) {
  return {
    ...toResourceDocument(entry.document),
    sourceKey: boundedResourceText(entry.source.sourceKey, MAX_EXTERNAL_SOURCE_KEY_CHARACTERS),
  };
}

function toResourceDocumentVersion(version: DocumentVersion) {
  const metadataTruncated =
    countUnicodeCharacters(version.metadataJson) > MAX_RESOURCE_METADATA_CHARACTERS;
  return {
    id: version.id,
    documentId: version.documentId,
    versionLabel:
      version.versionLabel === undefined
        ? null
        : boundedResourceText(version.versionLabel, MAX_CATALOG_VERSION_LABEL_CHARACTERS),
    contentHash: boundedResourceText(version.contentHash, MAX_RESOURCE_METADATA_FIELD_CHARACTERS),
    etag:
      version.etag === undefined
        ? null
        : boundedResourceText(version.etag, MAX_RESOURCE_METADATA_FIELD_CHARACTERS),
    lastModified:
      version.lastModified === undefined
        ? null
        : boundedResourceText(version.lastModified, MAX_RESOURCE_METADATA_FIELD_CHARACTERS),
    publishedAt: version.publishedAt?.toISOString() ?? null,
    fetchedAt: version.fetchedAt.toISOString(),
    isCurrent: version.isCurrent,
    extractionMode: version.extractionMode,
    contentType: boundedResourceText(version.contentType, MAX_CATALOG_MIME_TYPE_CHARACTERS),
    metadataJson: metadataTruncated ? null : version.metadataJson,
    metadataTruncated,
  };
}

function toCompactSectionEntry(entry: CatalogCurrentDocumentSection) {
  return {
    source: {
      id: entry.source.id,
      sourceKey: boundedResourceText(entry.source.sourceKey, MAX_EXTERNAL_SOURCE_KEY_CHARACTERS),
      displayName: boundedResourceText(
        entry.source.displayName,
        MAX_EXTERNAL_SOURCE_NAME_CHARACTERS,
      ),
    },
    document: {
      id: entry.document.id,
      publicId: boundedResourceText(
        entry.document.publicId,
        MAX_EXTERNAL_DOCUMENT_PUBLIC_ID_CHARACTERS,
      ),
      title: boundedResourceText(entry.document.title, MAX_EXTERNAL_TITLE_CHARACTERS),
      url: boundedResourceText(entry.document.canonicalUrl, MAX_CATALOG_URL_CHARACTERS),
    },
    section: toResourceSectionSummary(entry.section),
  };
}

function toResourceSectionEntry(entry: CatalogCurrentDocumentSection) {
  return {
    source: toResourceSource(entry.source),
    document: toResourceDocument(entry.document),
    section: toResourceSection(entry.section),
  };
}

function toResourceSectionSummary(section: DocumentSection) {
  return {
    id: section.id,
    documentVersionId: section.documentVersionId,
    ordinal: section.ordinal,
    heading:
      section.heading === undefined
        ? null
        : boundedResourceText(section.heading, MAX_EXTERNAL_HEADING_CHARACTERS),
    headingPath:
      section.headingPath === undefined
        ? null
        : boundedResourceText(section.headingPath, MAX_EXTERNAL_HEADING_PATH_CHARACTERS),
    headingLevel: section.headingLevel ?? null,
    anchor:
      section.anchor === undefined
        ? null
        : boundedResourceText(section.anchor, MAX_EXTERNAL_ANCHOR_CHARACTERS),
    contentHash: boundedResourceText(section.contentHash, MAX_RESOURCE_METADATA_FIELD_CHARACTERS),
    characterCount: section.characterCount,
    tokenCount: section.tokenCount ?? null,
  };
}

function toResourceSection(section: DocumentSection) {
  const content = truncateResourceText(section.content, MAX_RESOURCE_SECTION_CONTENT_CHARACTERS);
  return {
    ...toResourceSectionSummary(section),
    content,
    contentTruncated: countUnicodeCharacters(content) < countUnicodeCharacters(section.content),
  };
}

function boundedResourceText(value: string, maxCharacters: number): string {
  return truncateUnicode(value, maxCharacters);
}

function truncateResourceText(value: string, maxCharacters: number): string {
  return truncateUnicode(value, maxCharacters);
}

function parseNumericResourceId(
  uri: URL,
  collection: 'sources' | 'documents' | 'sections',
): number {
  const prefix = `mcp-search-net://${collection}/`;
  if (!uri.href.startsWith(prefix)) throw new Error(`Invalid ${collection} resource URI`);
  const [identifier] = uri.href.slice(prefix.length).split('/');
  return parseStrictResourceInteger(identifier ?? '', `${collection} id`, false);
}

function parsePageOffset(uri: URL, collection: 'sources' | 'documents' | 'versions' | 'sections') {
  const marker = collection === 'versions' ? '/versions/page/' : `//${collection}/page/`;
  const markerIndex = uri.href.lastIndexOf(marker);
  if (markerIndex === -1) throw new Error(`Invalid ${collection} page resource URI`);
  const offset = parseStrictResourceInteger(
    uri.href.slice(markerIndex + marker.length),
    `${collection} page offset`,
    true,
  );
  if (offset > MAX_CATALOG_PAGE_OFFSET) {
    throw new InvalidArgumentError(`Invalid ${collection} page offset`);
  }
  return offset;
}

function parseDocumentVersionResourceIds(uri: URL): {
  readonly documentId: number;
  readonly versionId: number;
} {
  const parts = uri.href.split('/');
  if (parts.length !== 6 || parts[4] !== 'versions') {
    throw new Error('Invalid document version resource URI');
  }
  return {
    documentId: parseStrictResourceInteger(parts[3] ?? '', 'document id', false),
    versionId: parseStrictResourceInteger(parts[5] ?? '', 'version id', false),
  };
}

function parseStrictResourceInteger(value: string, label: string, allowZero: boolean): number {
  if (!/^\d+$/u.test(value)) throw new Error(`Invalid ${label}`);
  const parsed = Number(value);
  const minimum = allowZero ? 0 : 1;
  if (!Number.isSafeInteger(parsed) || parsed < minimum) throw new Error(`Invalid ${label}`);
  return parsed;
}
