# ADR-004 — Utiliser SearXNG pour la recherche

- Statut : Accepté
- Date : 22 juin 2026

## Contexte

La V1 doit rechercher le Web sans API commerciale obligatoire et recevoir des résultats JSON structurés.

## Décision

Utiliser une instance SearXNG locale derrière le port `SearchProvider`, avec format JSON explicitement activé, timeout et réponse validée par Zod.

## Conséquences

La qualité dépend des moteurs configurés. Les pannes sont mappées vers des codes stables et peuvent utiliser un cache expiré autorisé.
