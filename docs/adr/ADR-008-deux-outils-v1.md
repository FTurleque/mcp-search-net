# ADR-008 — Limiter la V1 à deux outils MCP

- Statut : Accepté
- Date : 22 juin 2026

## Contexte

La découverte d'URL et l'extraction ciblée couvrent le besoin prioritaire tout en limitant la surface d'attaque.

## Décision

Exposer exactement `search_web` et `fetch_url`. Le premier ne télécharge pas les résultats ; le second ne recherche ni ne suit les liens automatiquement.

## Conséquences

Le contrat est simple à auditer et tester. Les opérations documentaires, versions et synchronisations sont réservées à la V2.
