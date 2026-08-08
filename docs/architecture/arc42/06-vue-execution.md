# Section 6 — Vue d'exécution (dynamique)

> arc42 · mcp-search-net v1.1.0 · 2026-08-08

Les noms d'acteurs sont strictement cohérents avec ceux de la [section 5](05-vue-blocs.md).

---

## 6.1 Scénario nominal — Recherche Web (`search_web`)

```mermaid
sequenceDiagram
    autonumber
    participant LLM as Agent LLM
    participant Pres as Présentation MCP
    participant UC as SearchWeb
    participant Cache as SqliteCacheRepository
    participant Prov as SearxngSearchProvider
    participant SearXNG as SearXNG (Docker)

    LLM->>Pres: MCP tools/call search_web {query, maxResults, …}
    Pres->>Pres: Validation Zod entrée
    Pres->>UC: execute(request, {requestId})
    UC->>UC: normalizeSearchRequest()
    UC->>UC: createSearchCacheKey()
    UC->>Cache: getSearch(key, allowStale=true)
    Cache-->>UC: undefined (MISS)
    UC->>Prov: search({query, language, maxResults × oversampling})
    Prov->>SearXNG: GET /search?q=…&format=json
    SearXNG-->>Prov: JSON résultats
    Prov-->>UC: SearchProviderResponse
    UC->>UC: rankAndDeduplicate() + applySourcePolicy()
    UC->>UC: truncate snippets
    UC->>Cache: setSearch(key, value, ttlMs)
    UC-->>Pres: ToolExecution{status, data, cacheStatus=MISS}
    Pres->>Pres: Validation Zod sortie
    Pres->>Pres: formatSearchText()
    Pres-->>LLM: MCP structuredContent + text fallback
```

---

## 6.2 Scénario nominal — Extraction de contenu (`fetch_url`)

```mermaid
sequenceDiagram
    autonumber
    participant LLM as Agent LLM
    participant Pres as Présentation MCP
    participant UC as FetchUrl
    participant Sec as PublicUrlSecurityPolicy
    participant Cache as SqliteCacheRepository
    participant GW as SecureHttpGateway
    participant San as PreparedHtmlSanitizer
    participant C4 as Crawl4aiContentFetcher
    participant Crawl4AI as Crawl4AI (Docker)

    LLM->>Pres: MCP tools/call fetch_url {url, maxCharacters, …}
    Pres->>Pres: Validation Zod entrée
    Pres->>UC: execute(request, {requestId})
    UC->>Sec: assertAllowed(url)
    Sec->>Sec: Validation protocole/port
    Sec->>Sec: DNS lookup → vérification adresse publique
    Sec-->>UC: ApprovedUrl {hostname, addresses}
    UC->>Cache: getContent(url)
    Cache-->>UC: undefined (MISS)
    UC->>GW: fetch(approvedUrl)
    GW->>GW: robots.txt check
    GW->>GW: Download (≤10 Mo, ≤20 s)
    GW-->>UC: RawContent {html, etag, …}
    UC->>San: neutralize(html)
    San-->>UC: SafeHtml (attributs actifs supprimés)
    UC->>C4: extract(safeHtml via raw://)
    C4->>Crawl4AI: POST /crawl {raw://document}
    Crawl4AI-->>C4: Markdown extrait
    C4-->>UC: ContentResult
    UC->>UC: selectSections() + limitCharacters()
    UC->>Cache: setContent(url, content, ttlMs)
    UC-->>Pres: ToolExecution{status, data, cacheStatus=MISS}
    Pres-->>LLM: MCP structuredContent + text fallback
```

---

## 6.3 Scénario nominal — Recherche documentaire (`search_docs` + `read_doc_section`)

```mermaid
sequenceDiagram
    autonumber
    participant LLM as Agent LLM
    participant Pres as Présentation MCP
    participant UC as SearchCatalogDocuments
    participant Repo as SqliteCatalogRepository
    participant FTS as SQLite FTS5 (catalog.db)

    LLM->>Pres: MCP tools/call search_docs {query, maxResults, …}
    Pres->>Pres: Validation Zod entrée
    Pres->>UC: execute({query, limit})
    UC->>Repo: searchDocuments({query, limit})
    Repo->>FTS: SELECT … FROM document_section_fts WHERE … MATCH ? ORDER BY bm25(…)
    FTS-->>Repo: Rows (section_id, document_id, …)
    Repo->>Repo: JOIN document_sections, documents, sources
    Repo-->>UC: CatalogDocumentSearchResult[]
    UC-->>Pres: SearchCatalogDocumentsOutput {results, query, resultCount}
    Pres->>Pres: toSearchDocsData() + truncate snippets
    Pres-->>LLM: search_docs response (sectionId dans chaque résultat)

    LLM->>Pres: MCP tools/call read_doc_section {sectionId, maxCharacters}
    Pres->>Repo: getCurrentDocumentSectionById(sectionId)
    Repo->>FTS: SELECT … FROM document_sections JOIN documents … WHERE id = ?
    Repo-->>Pres: CatalogCurrentDocumentSection
    Pres->>Pres: truncateText(content, maxCharacters)
    Pres-->>LLM: read_doc_section response (content, heading, url, …)
```

---

## 6.4 Scénario d'erreur — URL bloquée par SSRF

```mermaid
sequenceDiagram
    autonumber
    participant LLM as Agent LLM
    participant Pres as Présentation MCP
    participant UC as FetchUrl
    participant Sec as PublicUrlSecurityPolicy
    participant Tel as StructuredLogger (stderr)

    LLM->>Pres: MCP tools/call fetch_url {url: "http://192.168.1.1/secret"}
    Pres->>UC: execute(request)
    UC->>Sec: assertAllowed("http://192.168.1.1/secret")
    Sec->>Sec: isPublicIpv4("192.168.1.1") → false
    Sec->>Tel: record url_blocked {code: BLOCKED_ADDRESS, domain: "192.168.1.1"}
    Sec-->>UC: throw BlockedAddressError
    UC-->>Pres: throw BlockedAddressError
    Pres->>Tel: error log {tool: fetch_url, code: BLOCKED_ADDRESS}
    Pres-->>LLM: MCP isError:true {status: error, code: BLOCKED_ADDRESS}\n(sans adresse interne dans le message)
```

---

## 6.5 Scénario d'erreur — Panne SearXNG avec stale fallback

```mermaid
sequenceDiagram
    autonumber
    participant LLM as Agent LLM
    participant UC as SearchWeb
    participant Cache as SqliteCacheRepository
    participant Prov as SearxngSearchProvider
    participant Tel as StructuredLogger (stderr)

    LLM->>UC: search_web {query}
    UC->>Cache: getSearch(key, allowStale=true)
    Cache-->>UC: CachedEntry {value, stale: true}
    UC->>Prov: search(…)
    Prov-->>UC: throw SearchProviderUnavailableError
    UC->>UC: isTransientProviderError → true
    UC->>Tel: log cache_hit {stale: true}
    UC-->>LLM: ToolExecution{status: partial, cacheStatus: STALE_FALLBACK,\nwarnings: [STALE_CACHE_USED]}
```

---

## 6.6 Scénario d'exploitation — Démarrage du processus

```mermaid
sequenceDiagram
    autonumber
    participant OS as Système d'exploitation
    participant Main as main.ts
    participant Guard as runtime-guard.ts
    participant Cfg as loadConfiguration()
    participant Cnt as createContainer()
    participant Srv as McpServer (V2)

    OS->>Main: node build/bootstrap/main.js
    Main->>Guard: assertSupportedNodeVersion(process.versions.node)
    Guard-->>Main: OK (Node 24.x)
    Main->>Main: loadLocalEnvironment() → process.loadEnvFile('.env')
    Main->>Cfg: loadConfiguration(configPath)
    Cfg->>Cfg: YAML parse + env merge + Zod validation
    Cfg-->>Main: LoadedConfiguration
    Main->>Cnt: createContainer(loaded)
    Cnt->>Cnt: SqliteCacheRepository.open()
    Cnt->>Cnt: SqliteCatalogRepository.open() + migrations C001-C008
    Cnt->>Cnt: createMcpServer() V1 + V2 tools + resources
    Cnt-->>Main: {cache, catalog, logger, mcpServer}
    Main->>Main: register SIGINT / SIGTERM / uncaughtException
    Main->>Srv: connectStdio() → StdioServerTransport
    Main->>Main: logger.record server_started
    Note over Srv,OS: Le processus lit stdin en boucle et écrit JSON-RPC sur stdout
```
