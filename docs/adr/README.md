# Architecture Decision Records

Les ADR décrivent les décisions structurantes du projet. Leur statut `Accepté` correspond au code, aux validations ou au cadrage explicitement documenté. Toute évolution incompatible crée un nouvel ADR qui remplace explicitement l'ancien.

| ADR                                           | Décision                                                |
| --------------------------------------------- | ------------------------------------------------------- |
| [001](ADR-001-typescript-node.md)             | TypeScript et Node.js                                   |
| [002](ADR-002-mcp-stdio.md)                   | Transport MCP STDIO                                     |
| [003](ADR-003-architecture-hexagonale.md)     | Architecture hexagonale simplifiée                      |
| [004](ADR-004-searxng.md)                    | SearXNG pour la recherche                               |
| [005](ADR-005-crawl4ai.md)                   | Crawl4AI pour l'extraction                              |
| [006](ADR-006-sqlite-cache.md)                | SQLite comme cache V1                                   |
| [007](ADR-007-sans-llm-interne.md)            | Aucun LLM interne                                       |
| [008](ADR-008-deux-outils-v1.md)              | Deux outils MCP en V1                                   |
| [009](ADR-009-securite-reseau.md)             | Blocage des réseaux privés et contrôle des redirections |
| [010](ADR-010-v2-sqlite-fts5.md)              | Préparer la V2 avec SQLite FTS5                         |
| [011](ADR-011-v1-v2-boundary.md)              | Figer la frontière V1/V2 et les contrats publics        |
| [012](ADR-012-migration-sdk-mcp-v2.md)        | Historique du gel SDK 1.x pendant la V1                 |
| [013](ADR-013-sdk-mcp-v2-start-decision.md)   | Conserver le SDK 1.x, actuellement épinglé en `1.30.0`  |
| [014](ADR-014-catalog-db-isolation.md)        | Isoler le catalogue V2 dans `catalog.db`                |
| [015](ADR-015-fts5-contentless-delete.md)     | Utiliser FTS5 `contentless-delete` comme index dérivé   |
| [016](ADR-016-mcp-v2-tools-resources.md)      | Exposer cinq outils et des resources MCP bornées        |
| [017](ADR-017-search-quality-strategy-v2.md)  | Mesurer et améliorer la qualité de recherche locale V2  |
| [018](ADR-018-local-embeddings-evaluation.md) | Prototype vectoriel local, runtime inchangé             |
