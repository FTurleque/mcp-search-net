# ADR-002 — Utiliser le transport MCP STDIO

- Statut : Accepté
- Date : 22 juin 2026

## Contexte

Copilot dans l'IDE lance un processus local ; aucun serveur réseau MCP supplémentaire n'est nécessaire.

## Décision

Exposer MCP uniquement via STDIO. `stdout` contient exclusivement JSON-RPC ; tous les diagnostics structurés vont sur `stderr`.

## Conséquences

Le déploiement reste local et sans port MCP. Les lanceurs, tests et conteneurs doivent préserver la séparation des flux et fonctionner sans TTY.
