# ADR-002 — Utiliser le transport MCP STDIO

- Statut : Accepté
- Date : 22 juin 2026

## Contexte

Copilot dans l'IDE lance un processus local ; aucun serveur réseau MCP supplémentaire n'est nécessaire.

## Décision

Exposer MCP uniquement via STDIO avec `@modelcontextprotocol/sdk` 1.29.0, dernière release stable V1 vérifiée le 22 juin 2026. Cette génération fournit `McpServer`, `StdioServerTransport`, `registerTool(...)`, la validation des schémas et `structuredContent`. Les packages séparés de la génération suivante ne remplacent pas automatiquement ce SDK stable. `stdout` contient exclusivement JSON-RPC ; tous les diagnostics structurés vont sur `stderr`.

## Conséquences

Le déploiement reste local et sans port MCP. Les lanceurs, tests et conteneurs doivent préserver la séparation des flux et fonctionner sans TTY.
