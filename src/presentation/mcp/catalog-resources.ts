import { ResourceTemplate, type McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import type { CatalogRepository } from '../../application/ports/catalog-repository.js';
import type {
  CatalogCurrentDocumentSection,
  CatalogDocument,
  CatalogSource,
  DocumentSection,
  DocumentVersion,
} from '../../domain/models/catalog.js';

const RESOURCE_MIME_TYPE = 'application/json';

const CATALOG_RESOURCE_URIS = {
  catalog: 'mcp-search-net://catalog',
  sources: 'mcp-search-net://sources',
  source: 'mcp-search-net://sources/{sourceId}',
  documents: 'mcp-search-net://documents',
  document: 'mcp-search-net://documents/{documentId}',
  documentVersions: 'mcp-search-net://documents/{documentId}/versions',
  documentVersion: 'mcp-search-net://documents/{documentId}/versions/{versionId}',
  sections: 'mcp-search-net://sections',
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
      description: 'Read-only list of configured catalog sources.',
      mimeType: RESOURCE_MIME_TYPE,
    },
    async (uri) => jsonResource(uri, await createSourcesResource(repository)),
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
      description: 'Read-only list of catalog documents.',
      mimeType: RESOURCE_MIME_TYPE,
    },
    async (uri) => jsonResource(uri, await createDocumentsResource(repository)),
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
    'catalog-sections',
    CATALOG_RESOURCE_URIS.sections,
    {
      title: 'Catalog sections',
      description: 'Read-only list of current catalog document sections.',
      mimeType: RESOURCE_MIME_TYPE,
    },
    async (uri) => jsonResource(uri, await createSectionsResource(repository)),
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
  const [sources, documents, sections] = await Promise.all([
    repository.listSources(),
    repository.listDocuments(),
    repository.listCurrentDocumentSections(),
  ]);

  return {
    schemaVersion: '1.0',
    resources: Object.values(CATALOG_RESOURCE_URIS),
    counts: {
      sources: sources.length,
      enabledSources: sources.filter((source) => source.enabled).length,
      documents: documents.length,
      activeDocuments: documents.filter((document) => document.status === 'ACTIVE').length,
      currentSections: sections.length,
    },
  };
}

async function createSourcesResource(repository: CatalogRepository) {
  const sources = await repository.listSources();
  return {
    schemaVersion: '1.0',
    count: sources.length,
    sources: sources.map(toResourceSource),
  };
}

async function createSourceResource(repository: CatalogRepository, uri: URL) {
  const sourceId = parseNumericResourceId(uri, 'sources');
  const sources = await repository.listSources();
  const source = sources.find((candidate) => candidate.id === sourceId);
  return {
    schemaVersion: '1.0',
    sourceId,
    found: source !== undefined,
    source: source === undefined ? null : toResourceSource(source),
  };
}

async function createDocumentsResource(repository: CatalogRepository) {
  const documents = await repository.listDocuments();
  return {
    schemaVersion: '1.0',
    count: documents.length,
    documents: documents.map(toResourceDocument),
  };
}

async function createDocumentResource(repository: CatalogRepository, uri: URL) {
  const documentId = parseNumericResourceId(uri, 'documents');
  const documents = await repository.listDocuments();
  const document = documents.find((candidate) => candidate.id === documentId);
  return {
    schemaVersion: '1.0',
    documentId,
    found: document !== undefined,
    document: document === undefined ? null : toResourceDocument(document),
  };
}

async function createDocumentVersionsResource(repository: CatalogRepository, uri: URL) {
  const documentId = parseNumericResourceId(uri, 'documents');
  if (repository.listDocumentVersions === undefined) {
    return {
      schemaVersion: '1.0',
      documentId,
      available: false,
      count: 0,
      versions: [],
    };
  }
  const versions = await repository.listDocumentVersions(documentId);
  return {
    schemaVersion: '1.0',
    documentId,
    available: true,
    count: versions.length,
    versions: versions.map(toResourceDocumentVersion),
  };
}

async function createDocumentVersionResource(repository: CatalogRepository, uri: URL) {
  const { documentId, versionId } = parseDocumentVersionResourceIds(uri);
  if (repository.getDocumentVersion === undefined) {
    return {
      schemaVersion: '1.0',
      documentId,
      versionId,
      available: false,
      found: false,
      version: null,
    };
  }
  const version = await repository.getDocumentVersion(documentId, versionId);
  return {
    schemaVersion: '1.0',
    documentId,
    versionId,
    available: true,
    found: version !== undefined,
    version: version === undefined ? null : toResourceDocumentVersion(version),
  };
}

async function createSectionsResource(repository: CatalogRepository) {
  const sections = await repository.listCurrentDocumentSections();
  return {
    schemaVersion: '1.0',
    count: sections.length,
    sections: sections.map(toResourceSectionEntry),
  };
}

async function createSectionResource(repository: CatalogRepository, uri: URL) {
  const sectionId = parseNumericResourceId(uri, 'sections');
  const sections = await repository.listCurrentDocumentSections();
  const section = sections.find((candidate) => candidate.section.id === sectionId);
  return {
    schemaVersion: '1.0',
    sectionId,
    found: section !== undefined,
    entry: section === undefined ? null : toResourceSectionEntry(section),
  };
}

function jsonResource(uri: URL, value: unknown) {
  return {
    contents: [
      {
        uri: uri.href,
        mimeType: RESOURCE_MIME_TYPE,
        text: JSON.stringify(value, null, 2),
      },
    ],
  };
}

function toResourceSource(source: CatalogSource) {
  return {
    id: source.id,
    sourceKey: source.sourceKey,
    displayName: source.displayName,
    baseUrl: source.baseUrl,
    sourceType: source.sourceType,
    language: source.language,
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
    publicId: document.publicId,
    sourceId: document.sourceId,
    canonicalUrl: document.canonicalUrl,
    stableKey: document.stableKey,
    title: document.title,
    mimeType: document.mimeType,
    language: document.language,
    status: document.status,
    currentVersionId: document.currentVersionId ?? null,
    firstSeenAt: document.firstSeenAt.toISOString(),
    lastSeenAt: document.lastSeenAt.toISOString(),
    createdAt: document.createdAt.toISOString(),
    updatedAt: document.updatedAt.toISOString(),
  };
}

function toResourceDocumentVersion(version: DocumentVersion) {
  return {
    id: version.id,
    documentId: version.documentId,
    versionLabel: version.versionLabel ?? null,
    contentHash: version.contentHash,
    etag: version.etag ?? null,
    lastModified: version.lastModified ?? null,
    publishedAt: version.publishedAt?.toISOString() ?? null,
    fetchedAt: version.fetchedAt.toISOString(),
    isCurrent: version.isCurrent,
    extractionMode: version.extractionMode,
    contentType: version.contentType,
    metadataJson: version.metadataJson,
  };
}

function toResourceSectionEntry(entry: CatalogCurrentDocumentSection) {
  return {
    source: toResourceSource(entry.source),
    document: toResourceDocument(entry.document),
    section: toResourceSection(entry.section),
  };
}

function toResourceSection(section: DocumentSection) {
  return {
    id: section.id,
    documentVersionId: section.documentVersionId,
    ordinal: section.ordinal,
    heading: section.heading ?? null,
    headingPath: section.headingPath ?? null,
    headingLevel: section.headingLevel ?? null,
    anchor: section.anchor ?? null,
    content: section.content,
    contentHash: section.contentHash,
    characterCount: section.characterCount,
    tokenCount: section.tokenCount ?? null,
  };
}

function parseNumericResourceId(
  uri: URL,
  collection: 'sources' | 'documents' | 'sections',
): number {
  const prefix = `mcp-search-net://${collection}/`;
  if (!uri.href.startsWith(prefix)) return Number.NaN;
  return Number.parseInt(uri.href.slice(prefix.length), 10);
}

function parseDocumentVersionResourceIds(uri: URL): {
  readonly documentId: number;
  readonly versionId: number;
} {
  const match = /^mcp-search-net:\/\/documents\/(\d+)\/versions\/(\d+)$/u.exec(uri.href);
  if (match === null) return { documentId: Number.NaN, versionId: Number.NaN };
  const documentId = match[1] ?? String(Number.NaN);
  const versionId = match[2] ?? String(Number.NaN);
  return {
    documentId: Number.parseInt(documentId, 10),
    versionId: Number.parseInt(versionId, 10),
  };
}
