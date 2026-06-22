# ADR-006 — Utiliser SQLite comme cache V1

- Statut : Accepté
- Date : 22 juin 2026

## Contexte

Les appels Web doivent être sobres, rapides et résilients sans créer une base de connaissance permanente.

## Décision

Utiliser SQLite avec les tables explicites `search_cache`, `content_cache` et `schema_migrations`, des TTL, validateurs HTTP, hash, nettoyage et stale fallback. Le cache peut être désactivé ou abandonné après panne selon la configuration.

## Conséquences

Les réponses exposent `HIT`, `MISS`, `STALE_FALLBACK` ou `DISABLED`. Les migrations SQL sont numérotées et extensibles. SQLite V1 ne fournit ni catalogue, ni FTS, ni synchronisation documentaire durable.
