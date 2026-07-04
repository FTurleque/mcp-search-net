import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import type { CatalogRepository } from '../../application/ports/catalog-repository.js';
import type {
  CatalogCurrentDocumentSection,
  CatalogDocument,
  CatalogSource,
  DocumentSection,
} from '../../domain/models/catalog.js';

const RESOURCE_MIME_TYPE = 'application/json';

const CATALOG_RESOURCE_URIS = {
  catalog: 'mcp-search-net://catalog',
  sources: 'mcp-search-net://sources',
  documents: 'mcp-search-net://documents',
  sections: 'mcp-search-net://sections',
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
    'catalog-sections',
    CATALOG_RESOURCE_URIS.sections,
    {
      title: 'Catalog sections',
      description: 'Read-only list of current catalog document sections.',
      mimeType: RESOURCE_MIME_TYPE,
    },
    async (uri) => jsonResource(uri, await createSectionsResource(repository)),
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

async function createDocumentsResource(repository: CatalogRepository) {
  const documents = await repository.listDocuments();
  return {
    schemaVersion: '1.0',
    count: documents.length,
    documents: documents.map(toResourceDocument),
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
