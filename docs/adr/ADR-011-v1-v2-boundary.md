# ADR-011 — Figer la frontière entre la V1 et la V2 documentaire

- Statut : Accepté
- Date : 22 juin 2026

## Contexte

La V1 fournit une recherche Web et l'extraction contrôlée d'une URL. Une future V2 pourra ajouter un catalogue documentaire sans transformer le cache opportuniste actuel en base métier permanente.

## Décision

1. Le cache V1 est opportuniste, soumis à TTL et entièrement supprimable.
2. Le futur catalogue V2 sera un objet métier distinct du cache.
3. Les tables V1 `search_cache` et `content_cache` ne seront jamais réutilisées comme index V2.
4. Un futur index FTS5 sera dérivé du catalogue, reconstructible et stocké séparément.
5. Les seuls outils MCP publics V1 restent `search_web` et `fetch_url`.
6. Leurs noms, entrées, enveloppes de sortie, codes d'erreur et invariants de sécurité sont gelés avant le développement V2.
7. Une éventuelle synchronisation V2 sera pilotée par une CLI ou un worker dédié.
8. Les opérations de synchronisation ne seront pas exposées librement au LLM.

## Migrations et stockage

La V1 crée uniquement `schema_migrations`, `search_cache` et `content_cache`. Les migrations SQL numérotées sont additives et transactionnelles. Aucune table `documents`, `document_versions`, `document_sections`, `sources`, `index` ou `fts` n'est créée en V1.

## Conséquences

La V2 devra introduire ses propres modèles, tables, migrations et processus d'exploitation. Elle pourra consommer les contrats publics gelés, mais ne devra pas dépendre de la présence ou du contenu du cache V1.
