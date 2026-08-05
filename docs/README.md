# Documentation mcp-search-net

`mcp-search-net` est un serveur MCP Web local pour GitHub Copilot dans IntelliJ IDEA. Le candidat
`1.1.0` conserve les outils V1 `search_web` et `fetch_url` et ajoute les outils read-only
`search_docs`, `list_docs` et `read_doc_section`, soit exactement cinq outils, avec catalogue local,
synchronisation contrôlée et resources MCP read-only. Cette version V2 n'est pas encore publiée.

État autoritatif : [état courant du produit et des gates](status/current-state.md).

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
- [Exploitation catalogue V2.6](reference/catalog-operations-v2.md)
- [Budget de contexte catalogue](getting-started/catalog-token-budget.md)
- [Stratégie de recherche locale V2](reference/catalog-semantic-search-v2.md)

## Exploitation

- [Dépannage](operations/troubleshooting.md)
- [Supply chain et mises à jour](operations/supply-chain.md)
- [Observabilité](operations/observability.md)
- [Verrouillage de l'installation utilisateur](operations/install-user-lock.md)

## Développement

- [Guide de développement](development/guide.md)
- [Tests](development/testing.md)
- [Boîte à outils IA Copilot](development/copilot-ai-toolkit.md)
- [Hooks Git locaux](development/local-git-hooks.md)

## Planification

- [Feuille de route vers une V1 pleinement opérationnelle](planning/roadmap-v1-operationnelle.md)
- [Feuille de route V2 — Catalogue documentaire](planning/roadmap-v2-documentaire.md)
- [Spike IntelliJ/Copilot — MCP V2 documentaire](planning/spike-intellij-copilot-mcp-v2.md)
- [Benchmark V2](planning/benchmark-v2.md)
- [Validation Codex Desktop — MCP V2 documentaire](planning/validation-codex-desktop-mcp-v2-2026-07-05.md)
- [Lancement V2.6 — Automatisation contrôlée](planning/validation-v2-6-launch-2026-07-05.md)
- [Statut V2.6](planning/status-v2-6.md)
- [Validation locale V2.6](planning/validation-v2-6-local-success-2026-07-05.md)
- [Statut V2.7](planning/status-v2-7.md)
- [Validation locale V2.7](planning/validation-v2-7-local-success-2026-07-05.md)
- [Mise à jour roadmap V2.7](planning/roadmap-v2-update-v2-7.md)
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
- [ADR-017 — Stratégie de qualité de recherche V2](adr/ADR-017-search-quality-strategy-v2.md)

## État courant V2

Ne pas déduire l’état courant des preuves datées ci-dessus. Le verdict, l’inventaire public et les
gates encore ouverts sont maintenus dans [l’état courant](status/current-state.md).
