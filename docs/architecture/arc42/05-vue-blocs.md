# Section 5 — Vue des blocs (statique)

> arc42 · mcp-search-net v1.1.0 · 2026-08-08

---

## 5.1 Diagramme C4 Level 2 — Container

Le processus Node.js est le seul conteneur applicatif. Il embarque toutes les couches et s'appuie sur deux bases SQLite et deux services Docker externes.

```mermaid
flowchart TB
    subgraph client["«Person» / «Software System»\nClient MCP"]
        llm["Agent LLM\n(Copilot, Claude, Codex…)"]
    end

    subgraph node["«node»\nProcessus Node.js 24 — mcp-search-net v1.1.0"]
        direction TB
        bootstrap["«Component»\nBootstrap\nmain.ts · container.ts"]
        presentation["«Component»\nPrésentation MCP\nmcp-server.ts · mcp-server-v2.ts\ncatalog-resources.ts"]
        application["«Component»\nApplication\nuse-cases/ · ports/"]
        domain["«Component»\nDomaine\nmodels/ · errors/ · services/ · value-objects/"]
        infra["«Component»\nInfrastructure\nsearxng · crawl4ai · sqlite · config · security · logging"]
    end

    subgraph storage["«database»\nStockage local"]
        cache[("«database»\ncache.sqlite\nCache Web V1")]
        catalog[("«database»\ncatalog.db\nCatalogue V2")]
    end

    subgraph docker["«node»\nDocker Compose"]
        searxng["«Container»\nSearXNG\nMéta-moteur Web"]
        crawl4ai["«Container»\nCrawl4AI\nExtracteur HTML/PDF"]
    end

    llm -- "MCP JSON-RPC\nSTDIO" --> presentation
    bootstrap -- "assemble" --> presentation
    bootstrap -- "assemble" --> application
    bootstrap -- "assemble" --> infra
    presentation -- "invoque\nuse cases" --> application
    application -- "règles métier" --> domain
    infra -- "implémente\nports" --> application
    infra -- "lit/écrit" --> cache
    infra -- "lit/écrit" --> catalog
    infra -- "HTTP JSON" --> searxng
    infra -- "HTTP raw://" --> crawl4ai
```

---

## 5.2 Diagramme C4 Level 3 — Composants de la couche Application

```mermaid
flowchart TB
    subgraph uc["«Component»\nCas d'usage — src/application/use-cases/"]
        sw["SearchWeb\nsearch-web.ts"]
        fu["FetchUrl\nfetch-url.ts"]
        scd["SearchCatalogDocuments\nsearch-catalog-documents.ts"]
        lcs["LoadCatalogSources\nload-catalog-sources.ts"]
        sync["SyncCatalogDocuments\nsync-catalog-documents.ts"]
        mc["MaintainCatalog\nmaintain-catalog.ts"]
        ri["RebuildCatalogIndex\nrebuild-catalog-index.ts"]
        pc["PurgeCatalogVersions\npurge-catalog-versions.ts"]
        vc["VerifyCatalog\nverify-catalog.ts"]
    end

    subgraph ports["«interface»\nPorts — src/application/ports/"]
        sp["SearchProvider"]
        cf["ContentFetcher"]
        cr["CacheRepository"]
        cat["CatalogRepository"]
        osr["OfficialSourceRegistry"]
        usp["UrlSecurityPolicy"]
        dns["DnsResolver"]
        clk["Clock"]
        log["Logger"]
    end

    sw -- "utilise" --> sp
    sw -- "utilise" --> cr
    sw -- "utilise" --> osr
    fu -- "utilise" --> cf
    fu -- "utilise" --> cr
    fu -- "utilise" --> usp
    fu -- "utilise" --> osr
    scd -- "utilise" --> cat
    lcs -- "utilise" --> cat
    sync -- "utilise" --> cat
    sync -- "utilise" --> cf
    mc -- "utilise" --> cat
    ri -- "utilise" --> cat
    pc -- "utilise" --> cat
    vc -- "utilise" --> cat
```

---

## 5.3 Diagramme C4 Level 3 — Composants de la couche Infrastructure

```mermaid
flowchart TB
    subgraph infra["«Component»\nInfrastructure — src/infrastructure/"]
        searxngAdp["«adapter»\nSearxngSearchProvider\nsearxng-search-provider.ts\n\nimplements SearchProvider"]
        c4adp["«adapter»\nCrawl4aiContentFetcher\ncrawl4ai-content-fetcher.ts\n\nimplements ContentFetcher"]
        gw["«adapter»\nSecureHttpGateway\nsecure-http-gateway.ts\n\nSSRF · robots.txt · throttle"]
        san["«adapter»\nPreparedHtmlSanitizer\nprepared-html-sanitizer.ts"]
        sec["«adapter»\nPublicUrlSecurityPolicy\npublic-url-security-policy.ts\n\nimplements UrlSecurityPolicy"]
        dnsAdp["«adapter»\nNodeDnsResolver\nnode-dns-resolver.ts\n\nimplements DnsResolver"]
        cacheAdp["«adapter»\nSqliteCacheRepository\nsqlite-cache-repository.ts\n\nimplements CacheRepository"]
        safeCache["«adapter»\nSafeCacheRepository\nsafe-cache-repository.ts\n\ndécorateur fallback"]
        catalogAdp["«adapter»\nSqliteCatalogRepository\nsqlite-catalog-repository.ts\n\nimplements CatalogRepository"]
        cfgAdp["«adapter»\nYamlLoader · ApplicationConfig\nyaml-loader.ts"]
        logAdp["«adapter»\nStructuredLogger\nstructured-logger.ts\n\nimplements Logger"]
        clkAdp["«adapter»\nSystemClock\nsystem-clock.ts\n\nimplements Clock"]
        pdfAdp["«adapter»\nPdfTextExtractor\npdf-text-extractor.ts"]
        lockAdp["«adapter»\nFileLeaselock\nfile-lease-lock.ts"]
    end

    safeCache -- "wraps" --> cacheAdp
    c4adp -- "utilise" --> gw
    c4adp -- "utilise" --> san
    gw -- "utilise" --> sec
    gw -- "utilise" --> dnsAdp
```

---

## 5.4 Composants du catalogue SQLite (zoom interne)

`SqliteCatalogRepository` est une façade qui délègue à cinq classes spécialisées partageant **une seule connexion SQLite** (intentionnel pour les transactions atomiques).

```mermaid
classDiagram
    class SqliteCatalogRepository {
        «adapter»
        +addSource()
        +commitDocumentRevision()
        +searchDocuments()
        +rebuildSearchIndex()
        +verifyIntegrity()
        +close()
    }
    class SqliteCatalogSourceStore {
        «adapter»
        +add()
        +update()
        +getByKey()
        +listPage()
    }
    class SqliteCatalogReadModel {
        «adapter»
        +getDocumentByPublicId()
        +listDocumentsPage()
        +getCurrentDocumentSectionById()
    }
    class SqliteCatalogRevisionWriter {
        «adapter»
        +commit() : transaction atomique
        +upsertDocument()
        +replaceDocumentSections()
    }
    class SqliteCatalogSearch {
        «adapter»
        +search() : FTS5 BM25
    }
    class SqliteCatalogSyncStore {
        «adapter»
        +start()
        +complete()
    }

    SqliteCatalogRepository --> SqliteCatalogSourceStore : partage connexion SQLite
    SqliteCatalogRepository --> SqliteCatalogReadModel : partage connexion SQLite
    SqliteCatalogRepository --> SqliteCatalogRevisionWriter : partage connexion SQLite
    SqliteCatalogRepository --> SqliteCatalogSearch : partage connexion SQLite
    SqliteCatalogRepository --> SqliteCatalogSyncStore : partage connexion SQLite
```

---

## 5.5 Composants de la couche Présentation MCP

```mermaid
flowchart TB
    subgraph pres["«Component»\nPrésentation MCP — src/presentation/mcp/"]
        v1["«adapter»\ncreateMcpServer (V1)\nmcp-server.ts\n\nregistre search_web\nregistre fetch_url"]
        v2["«adapter»\ncreateMcpServer (V2)\nmcp-server-v2.ts\n\nregistre search_docs\nregistre list_docs\nregistre read_doc_section"]
        res["«adapter»\nregisterCatalogResources\ncatalog-resources.ts\n\n4 resources statiques\n9 resource templates"]
        tc["executeToolCall\ntool-call.ts\n\nlog · erreur · format texte"]
        schemas["«interface»\nschemas/\nZod input/output\npar outil"]
    end

    v2 -- "extends" --> v1
    v2 -- "registre resources" --> res
    v1 -- "utilise" --> tc
    v2 -- "utilise" --> tc
    v1 -- "utilise" --> schemas
    v2 -- "utilise" --> schemas
```

---

## 5.6 Hiérarchie des erreurs du domaine

```mermaid
classDiagram
    class ApplicationError {
        «domain»
        +code: ToolErrorCode
    }
    class ConfigurationError
    class UrlSecurityError {
        +code: BLOCKED_ADDRESS | INVALID_URL | …
    }
    class ExternalServiceError {
        +service: searxng | crawl4ai
    }
    class InvalidArgumentError
    class RequestTimeoutError
    class ResponseTooLargeError
    class HttpError { +status: number }
    class CacheUnavailableError
    class NoRelevantContentError

    ApplicationError <|-- ConfigurationError
    ApplicationError <|-- UrlSecurityError
    ApplicationError <|-- ExternalServiceError
    ApplicationError <|-- InvalidArgumentError
    ApplicationError <|-- RequestTimeoutError
    ApplicationError <|-- ResponseTooLargeError
    ApplicationError <|-- HttpError
    ApplicationError <|-- CacheUnavailableError
    ApplicationError <|-- NoRelevantContentError
    UrlSecurityError <|-- BlockedAddressError
    UrlSecurityError <|-- DnsResolutionError
    ExternalServiceError <|-- SearchProviderUnavailableError
    ExternalServiceError <|-- ContentProviderUnavailableError
    InvalidArgumentError <|-- InvalidSearchQueryError
    InvalidArgumentError <|-- InvalidWebUrlError
    NoRelevantContentError <|-- NoOfficialSourceFoundError
```

---

## 5.7 Référence des fichiers source par composant

| Composant               | Fichier(s) principal(aux)                                                                            |
| ----------------------- | ---------------------------------------------------------------------------------------------------- |
| Bootstrap               | `src/bootstrap/main.ts`, `src/bootstrap/container.ts`, `src/bootstrap/runtime-guard.ts`              |
| MCP Server V1           | `src/presentation/mcp/mcp-server.ts`                                                                 |
| MCP Server V2           | `src/presentation/mcp/mcp-server-v2.ts`                                                              |
| Catalog Resources       | `src/presentation/mcp/catalog-resources.ts`                                                          |
| Tool execution          | `src/presentation/mcp/tool-call.ts`                                                                  |
| SearchWeb               | `src/application/use-cases/search-web.ts`                                                            |
| FetchUrl                | `src/application/use-cases/fetch-url.ts`                                                             |
| SearchCatalogDocuments  | `src/application/use-cases/search-catalog-documents.ts`                                              |
| SyncCatalogDocuments    | `src/application/use-cases/sync-catalog-documents.ts`                                                |
| Ports (interfaces)      | `src/application/ports/*.ts`                                                                         |
| Domain models           | `src/domain/models/*.ts`, `src/domain/value-objects/*.ts`                                            |
| Domain errors           | `src/domain/errors/domain-errors.ts`                                                                 |
| SearxngSearchProvider   | `src/infrastructure/search/searxng-search-provider.ts`                                               |
| Crawl4aiContentFetcher  | `src/infrastructure/fetch/crawl4ai-content-fetcher.ts`                                               |
| SecureHttpGateway       | `src/infrastructure/fetch/secure-http-gateway.ts`                                                    |
| PreparedHtmlSanitizer   | `src/infrastructure/fetch/prepared-html-sanitizer.ts`                                                |
| PublicUrlSecurityPolicy | `src/infrastructure/security/public-url-security-policy.ts`                                          |
| SqliteCacheRepository   | `src/infrastructure/cache/sqlite-cache-repository.ts`                                                |
| SqliteCatalogRepository | `src/infrastructure/catalog/sqlite-catalog-repository.ts`                                            |
| Configuration           | `src/infrastructure/config/application-config.ts`, `src/infrastructure/config/load-configuration.ts` |
| StructuredLogger        | `src/infrastructure/logging/structured-logger.ts`                                                    |
