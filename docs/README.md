# Documentation mcp-search-net

`mcp-search-net` est un serveur MCP Web local pour GitHub Copilot dans IntelliJ IDEA. La V1 expose uniquement `search_web` et `fetch_url`, sans LLM interne ni API commerciale obligatoire.

## Démarrage

1. [Installer sous Windows](getting-started/installation-windows.md)
2. [Configurer IntelliJ IDEA et GitHub Copilot](getting-started/intellij-copilot.md)
3. [Utiliser les outils MCP](getting-started/usage.md)

## Référence technique

- [Architecture](reference/architecture.md)
- [Configuration](reference/configuration.md)
- [Contrats des outils](reference/tools.md)
- [Sécurité](reference/security.md)

## Exploitation

- [Dépannage](operations/troubleshooting.md)

## Développement

- [Guide de développement](development/guide.md)
- [Tests](development/testing.md)
- [Boîte à outils IA Copilot](development/copilot-ai-toolkit.md)

## Planification

- [Feuille de route vers une V1 pleinement opérationnelle](planning/roadmap-v1-operationnelle.md)
- [Rapport de validation des phases 0 et 1](planning/validation-phase-0-1.md)
- [Rapport de validation de la phase 2](planning/validation-phase-2.md)

La documentation décrit la V1. L’indexation documentaire, FTS/BM25, les embeddings et la synchronisation restent hors périmètre.
