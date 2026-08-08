# Section 4 — Stratégie de solution

> arc42 · mcp-search-net v1.1.0 · 2026-08-08

---

## 4.1 Principes architecturaux

| # | Principe | Application dans le code |
|---|---|---|
| P1 | **Architecture hexagonale** — le domaine est protégé des détails techniques | `src/domain/` n'importe rien d'`infrastructure/`, MCP SDK, SQLite, YAML ni Zod (ADR-003) |
| P2 | **Ports et adaptateurs** — chaque service externe est abstrait par un port | `SearchProvider`, `ContentFetcher`, `CacheRepository`, `CatalogRepository`, `UrlSecurityPolicy`, `DnsResolver`, `Clock`, `Telemetry`, `Logger` |
| P3 | **Confiance zéro envers les entrées** — toute URL, contenu Web et argument outil est traité comme hostile | Validation Zod en entrée, SSRF systématique, neutralisation HTML avant Crawl4AI |
| P4 | **Séparation des contrats V1/V2** — le cache opportuniste et le catalogue durable ne se mélangent jamais | Deux bases SQLite distinctes, migrations séparées, outils dédiés (ADR-011, ADR-014) |
| P5 | **Pas de LLM, pas d'API commerciale** — tout traitement est déterministe et local | Classement BM25, règles de pertinence lexicales, pas d'embedding en runtime (ADR-007, ADR-018) |
| P6 | **Immuabilité des décisions de migration SQL** — une migration appliquée ne change jamais | SHA-256 normalisé de chaque migration, runner qui refuse toute dérive (ADR-014) |
| P7 | **STDIO réservé au JSON-RPC** — aucun `console.log` dans le code de production | `stderr` pour tous les logs structurés ; CI vérifie l'absence de pollution `stdout` |

---

## 4.2 Style de décomposition

Le code est organisé en cinq couches. Les **dépendances d'import pointent exclusivement vers l'intérieur** :

```
presentation  →  application  →  domain
infrastructure  →  application/ports
bootstrap  →  tout (point de composition unique)
```

| Couche | Dossier | Rôle |
|---|---|---|
| **Domaine** | `src/domain/` | Modèles, objets de valeur, règles déterministes, hiérarchie d'erreurs stables |
| **Application** | `src/application/` | Ports (interfaces), cas d'usage, services d'application |
| **Infrastructure** | `src/infrastructure/` | Adaptateurs : SearXNG, Crawl4AI, SQLite, YAML, DNS, horloge, logs |
| **Présentation** | `src/presentation/mcp/` | Schémas Zod, handlers MCP, formatage texte, resources MCP |
| **Bootstrap** | `src/bootstrap/` | Composition des dépendances, cycle de vie STDIO, garde de version Node |

---

## 4.3 Technologies structurantes

| Technologie | Version épinglée | Rôle |
|---|---|---|
| Node.js | 24 LTS (`>=24 <25`) | Runtime — imposé par ADR-001 |
| TypeScript | 5.9.3 | Langage — strict mode + ESM NodeNext |
| `@modelcontextprotocol/sdk` | 1.30.0 | Transport STDIO + registration outils/resources |
| `better-sqlite3` | 13.0.3 | Cache V1 + catalogue V2, FTS5, transactions atomiques |
| `zod` | 4.x | Validation entrées/sorties, schémas d'outils MCP |
| `yaml` | 2.x | Chargement de la configuration et du registre de sources |
| `pdfjs-dist` | 6.2.108 | Extraction texte depuis PDF (hors OCR) |
| SearXNG | digest `d0f6ccf9…` | Méta-recherche Web — Docker local |
| Crawl4AI | digest `385042cb…` | Extraction HTML — Docker local |

---

## 4.4 Mécanismes répondant aux objectifs qualité

| Attribut | Mécanisme |
|---|---|
| **Sécurité** | `PublicUrlSecurityPolicy` : blocklist IP, validation DNS, re-validation post-redirect, limitation des ports ; `PreparedHtmlSanitizer` : neutralisation avant Crawl4AI |
| **Fiabilité** | `SafeCacheRepository` : wrapping avec fallback sur `DisabledCacheRepository` si erreur SQLite ; stale fallback en cas de panne provider ; codes d'erreur stables |
| **Maintenabilité** | Architecture hexagonale, ports injectables, tests par couche, `npm run check` automatisé |
| **Performance** | Cache SQLite avec TTL différenciés (1 h recherche, 24 h documentation) ; FTS5 BM25 p95 < 20 ms ; index de pagination C008 |
| **Portabilité** | ZIP Windows auto-extractible avec Node.js 24 embarqué, installateur Inno Setup, configuration 100 % par variables d'environnement |
| **Auditabilité** | Logs structurés JSON sur `stderr`, `requestId` de corrélation, codes d'erreur publics stables, `schemaVersion` dans chaque réponse |

---

## 4.5 Liens vers les décisions architecturales

| ADR | Décision |
|---|---|
| [ADR-001](../../adr/ADR-001-typescript-node.md) | TypeScript + Node.js 24 |
| [ADR-002](../../adr/ADR-002-mcp-stdio.md) | Transport MCP STDIO |
| [ADR-003](../../adr/ADR-003-architecture-hexagonale.md) | Architecture hexagonale |
| [ADR-007](../../adr/ADR-007-sans-llm-interne.md) | Pas de LLM interne |
| [ADR-009](../../adr/ADR-009-securite-reseau.md) | Blocage des réseaux privés |
| [ADR-011](../../adr/ADR-011-v1-v2-boundary.md) | Frontière V1/V2 |
| [ADR-014](../../adr/ADR-014-catalog-db-isolation.md) | Isolation `catalog.db` |
| [ADR-017](../../adr/ADR-017-search-quality-strategy-v2.md) | Stratégie de recherche FTS5/BM25 |
| [ADR-018](../../adr/ADR-018-local-embeddings-evaluation.md) | Évaluation embeddings locaux |
