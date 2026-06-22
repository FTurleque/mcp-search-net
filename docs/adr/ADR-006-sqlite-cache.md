# ADR-006 — Utiliser SQLite comme cache V1

- Statut : Accepté
- Date : 22 juin 2026

## Contexte

Les appels Web doivent être sobres, rapides et résilients sans créer une base de connaissance permanente.

## Décision

Utiliser SQLite avec espaces typés, TTL, validateurs HTTP, hash, pruning et stale fallback. Le cache peut être désactivé ou abandonné après panne selon la configuration.

## Conséquences

Les réponses exposent `HIT`, `MISS`, `STALE_FALLBACK` ou `DISABLED`. SQLite V1 ne fournit ni catalogue, ni FTS, ni synchronisation documentaire durable.
