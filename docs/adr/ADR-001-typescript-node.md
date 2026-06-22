# ADR-001 — Utiliser TypeScript et Node.js

- Statut : Accepté
- Date : 22 juin 2026

## Contexte

Le serveur doit intégrer le SDK MCP officiel, exécuter un transport STDIO portable et conserver des contrats strictement typés.

## Décision

Utiliser TypeScript strict sur Node.js 24 LTS, avec compilation ESM et lockfile npm.

## Conséquences

Les erreurs de types sont bloquantes en CI et le runtime majeur est vérifié avant la suite. Le projet dépend du cycle LTS Node et doit planifier ses migrations de runtime.
