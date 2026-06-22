# Documentation mcp-search-net

`mcp-search-net` est un serveur MCP Web local pour GitHub Copilot dans IntelliJ IDEA. La V1 expose uniquement `search_web` et `fetch_url`, sans LLM interne ni API commerciale obligatoire.

## Démarrage

1. [Installer sous Windows](getting-started/installation-windows.md)
2. [Configurer IntelliJ IDEA et GitHub Copilot](getting-started/intellij-copilot.md)
3. [Utiliser les outils MCP](getting-started/usage.md)

## Référence technique

- [Architecture — point d'entrée stable](architecture.md)
- [Sécurité — point d'entrée stable](security.md)
- [Architecture](reference/architecture.md)
- [Configuration](reference/configuration.md)
- [Contrats des outils](reference/tools.md)
- [Sécurité](reference/security.md)

## Exploitation

- [Dépannage](operations/troubleshooting.md)
- [Observabilité](operations/observability.md)

## Développement

- [Guide de développement](development/guide.md)
- [Tests](development/testing.md)
- [Boîte à outils IA Copilot](development/copilot-ai-toolkit.md)

## Planification

- [Feuille de route vers une V1 pleinement opérationnelle](planning/roadmap-v1-operationnelle.md)
- [Rapport de validation des phases 0 et 1](planning/validation-phase-0-1.md)
- [Rapport de validation de la phase 2](planning/validation-phase-2.md)
- [Rapport de validation des phases 3 et 4](planning/validation-phase-3-4.md)
- [Rapport de validation des phases 5 à 7](planning/validation-phase-5-7.md)
- [Rapport de validation des phases 8 et 9](planning/validation-phase-8-9.md)
- [Validation finale V1 du 22 juin 2026](planning/validation-v1-finale-2026-06-22.md)
- [Validation V1 et décision V2 du 22 juin 2026](planning/validation-v1-v2-go-no-go-2026-06-22.md)
- [Validation V1 après alignement du build](planning/validation-v1-build-2026-06-22.md)
- [Matrice de traçabilité V1](planning/traceabilite-v1.md)
- [Benchmark V1 du 22 juin 2026](planning/benchmark-v1-2026-06-22.md)
- [Recette manuelle IntelliJ](planning/recette-intellij-v1.md)
- [Versions de recette](planning/versions-recette-v1.md)

## Décisions d’architecture

- [Index ADR-001 à ADR-011](adr/README.md)

La documentation décrit la V1. L’indexation d’un catalogue documentaire, FTS/BM25, les embeddings et la synchronisation restent hors périmètre ; `fetch_url` utilise seulement un sélecteur lexical déterministe sur la page courante.
