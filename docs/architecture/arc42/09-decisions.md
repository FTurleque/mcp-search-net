# Section 9 — Décisions architecturales (index ADR)

> arc42 · mcp-search-net v1.1.0 · 2026-08-08

Les ADR détaillés se trouvent dans [`docs/adr/`](../../adr/). Cette section est un index de navigation et de traçabilité ; les ADR complets ne sont pas recopiés ici.

---

## 9.1 Index des ADR

| ID                                                          | Titre                                                             | Statut                     | Date                             | Remplacé par        |
| ----------------------------------------------------------- | ----------------------------------------------------------------- | -------------------------- | -------------------------------- | ------------------- |
| [ADR-001](../../adr/ADR-001-typescript-node.md)             | Utiliser TypeScript et Node.js                                    | Accepté                    | 2026-06-22                       | —                   |
| [ADR-002](../../adr/ADR-002-mcp-stdio.md)                   | Utiliser le transport MCP STDIO                                   | Accepté                    | 2026-06-22                       | —                   |
| [ADR-003](../../adr/ADR-003-architecture-hexagonale.md)     | Retenir une architecture hexagonale simplifiée                    | Accepté                    | 2026-06-22                       | —                   |
| [ADR-004](../../adr/ADR-004-searxng.md)                     | Utiliser SearXNG pour la recherche                                | Accepté                    | 2026-06-22                       | —                   |
| [ADR-005](../../adr/ADR-005-crawl4ai.md)                    | Utiliser Crawl4AI pour l'extraction                               | Accepté                    | 2026-06-22                       | —                   |
| [ADR-006](../../adr/ADR-006-sqlite-cache.md)                | Utiliser SQLite comme cache V1                                    | Accepté                    | 2026-06-22                       | —                   |
| [ADR-007](../../adr/ADR-007-sans-llm-interne.md)            | Ne pas utiliser de LLM interne                                    | Accepté                    | 2026-06-22                       | —                   |
| [ADR-008](../../adr/ADR-008-deux-outils-v1.md)              | Limiter la V1 à deux outils MCP                                   | Accepté                    | 2026-06-22                       | ADR-016 (étendu)    |
| [ADR-009](../../adr/ADR-009-securite-reseau.md)             | Bloquer les réseaux privés et contrôler les redirections          | Accepté                    | 2026-06-22                       | —                   |
| [ADR-010](../../adr/ADR-010-v2-sqlite-fts5.md)              | Préparer la V2 avec SQLite FTS5                                   | Accepté (implémenté en V2) | 2026-06-22                       | ADR-015 (précision) |
| [ADR-011](../../adr/ADR-011-v1-v2-boundary.md)              | Figer la frontière entre la V1 et la V2 documentaire              | Accepté                    | 2026-06-22                       | —                   |
| [ADR-012](../../adr/ADR-012-migration-sdk-mcp-v2.md)        | Planifier la migration SDK MCP v2 hors périmètre V1               | Historique                 | 2026-06-27                       | ADR-013             |
| [ADR-013](../../adr/ADR-013-sdk-mcp-v2-start-decision.md)   | Décision de démarrage SDK MCP v2                                  | Accepté                    | Non lu — **Hypothèse à valider** | —                   |
| [ADR-014](../../adr/ADR-014-catalog-db-isolation.md)        | Isoler le catalogue V2 dans `catalog.db`                          | Accepté                    | 2026-07-03                       | —                   |
| [ADR-015](../../adr/ADR-015-fts5-contentless-delete.md)     | Utiliser FTS5 `contentless-delete` comme index dérivé             | Accepté                    | 2026-07-03                       | —                   |
| [ADR-016](../../adr/ADR-016-mcp-v2-tools-resources.md)      | Exposer la V2 avec des outils ciblés et des resources MCP bornées | Accepté                    | 2026-07-03                       | —                   |
| [ADR-017](../../adr/ADR-017-search-quality-strategy-v2.md)  | Choisir la stratégie de recherche V2 sur benchmark mesuré         | Accepté                    | 2026-07-29                       | —                   |
| [ADR-018](../../adr/ADR-018-local-embeddings-evaluation.md) | Évaluer les embeddings locaux sans les intégrer avant preuve      | Accepté                    | 2026-08-06                       | —                   |

---

## 9.2 Regroupement thématique

### Technologie de base

ADR-001 (TypeScript/Node), ADR-002 (STDIO), ADR-003 (hexagonale), ADR-012, ADR-013 (SDK MCP)

### Fournisseurs externes

ADR-004 (SearXNG), ADR-005 (Crawl4AI)

### Stockage

ADR-006 (cache V1), ADR-010 (FTS5 préparation), ADR-014 (catalog.db), ADR-015 (contentless-delete)

### Contrat MCP et frontières

ADR-007 (pas de LLM), ADR-008 (deux outils V1), ADR-011 (frontière V1/V2), ADR-016 (cinq outils V2 + resources)

### Sécurité

ADR-009 (réseaux privés)

### Qualité de recherche

ADR-017 (FTS5/BM25 baseline), ADR-018 (embeddings — prototype autorisé, pas intégré)

---

## 9.3 ADR à créer (lacunes identifiées)

| Sujet                                                  | Justification                                                                                           |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------- |
| **Installateur Windows Inno Setup**                    | Choix coûteux à inverser (format distribution, cycle lifecycle, clés registry) ; aucun ADR dédié trouvé |
| **robots.txt compliance**                              | Décision de conformité avec impact sur la surface d'attaque et la fiabilité                             |
| **Chunking des sections (12 000 chars + overlap 400)** | Paramètre structurant pour la qualité FTS et la taille des réponses                                     |
| **Prototype vectoriel local (suite ADR-018)**          | À créer lorsque le prototype démarrera, couvrant persistance, packaging, licence, offline               |
