# Documentation mcp-search-net

`mcp-search-net` est un serveur MCP Web local pour GitHub Copilot dans IntelliJ IDEA. La V1 expose `search_web` et `fetch_url`. La V2 documentaire est en cours de stabilisation dans la PR #8 avec catalogue local, recherche documentaire, synchronisation contrôlée, outil `search_docs` et resources MCP read-only.

## Démarrage

1. [Installer sous Windows](getting-started/installation-windows.md)
2. [Configurer IntelliJ IDEA et GitHub Copilot](getting-started/intellij-copilot.md)
3. [Utiliser les outils MCP](getting-started/usage.md)

## Référence technique

- [Architecture](reference/architecture.md)
- [Configuration](reference/configuration.md)
- [Contrats des outils](reference/tools.md)
- [Sécurité](reference/security.md)
- [Schéma catalogue V2](reference/catalog-schema-v2.md)
- [Synchronisation catalogue V2](reference/catalog-sync-v2.md)

## Exploitation

- [Dépannage](operations/troubleshooting.md)
- [Observabilité](operations/observability.md)

## Développement

- [Guide de développement](development/guide.md)
- [Tests](development/testing.md)
- [Boîte à outils IA Copilot](development/copilot-ai-toolkit.md)

## Planification

- [Feuille de route vers une V1 pleinement opérationnelle](planning/roadmap-v1-operationnelle.md)
- [Feuille de route V2 — Catalogue documentaire](planning/roadmap-v2-documentaire.md)
- [Benchmark V2](planning/benchmark-v2.md)
- [Validation finale V1 — Recette complète 27 juin 2026](planning/validation-v1-recette-finale-2026-06-27.md)
- [Décision V1/V2 go/no-go du 22 juin 2026](planning/validation-v1-v2-go-no-go-2026-06-22.md)
- [Matrice de traçabilité V1](planning/traceabilite-v1.md)
- [Recette manuelle IntelliJ](planning/recette-intellij-v1.md)

## Décisions d’architecture

- [Index ADR-001 à ADR-011](adr/README.md)
- [ADR-012 — Migration SDK MCP v2](adr/ADR-012-migration-sdk-mcp-v2.md)
- [ADR-013 — SDK MCP V1 au démarrage V2](adr/ADR-013-sdk-mcp-v2-start-decision.md)
- [ADR-014 — Isolation catalog.db](adr/ADR-014-catalog-db-isolation.md)
- [ADR-015 — FTS5 contentless-delete](adr/ADR-015-fts5-contentless-delete.md)
- [ADR-016 — Outil et resources MCP V2](adr/ADR-016-mcp-v2-tools-resources.md)

## État courant V2

- PR active : #8 — `feat/v2-catalog-storage`, conservée en draft.
- Dernier head validé CI complète : `4bfb191da05768759b6a9d8531aa3fd5762612c1`.
- GitHub Actions est temporairement en déclenchement manuel uniquement via `workflow_dispatch`.
- À finaliser : validation du head courant de PR, sync exhaustive, rate limiting, reprise après interruption et spike IntelliJ/Copilot sur les resources MCP V2.
