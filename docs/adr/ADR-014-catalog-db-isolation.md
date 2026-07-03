# ADR-014 — Isoler le catalogue V2 dans `catalog.db`

- **Statut** : Accepté pour V2.0
- **Date** : 2026-07-03
- **Décision liée** : ADR-006, ADR-011

## Contexte

La V1 utilise SQLite comme cache opportuniste. Ce cache est soumis à TTL, peut être purgé et sert uniquement les outils `search_web` et `fetch_url`.

L'ADR-011 interdit de transformer `search_cache` ou `content_cache` en index métier V2. La V2 doit introduire un catalogue documentaire durable, versionné et reconstructible.

Le mécanisme de migration V1 actuel applique les migrations du cache à la base ouverte par le repository de cache. Mélanger des migrations V2 dans ce flux augmenterait le risque de créer des tables métier dans la base opportuniste.

## Décision

La V2 utilise une base SQLite distincte :

```text
.data/cache.db    -> cache opportuniste V1, supprimable
.data/catalog.db  -> catalogue documentaire V2, durable
```

Le catalogue V2 dispose de son propre runner de migrations, de sa propre connexion SQLite, de ses propres repositories et de ses propres tests d'intégration.

Les migrations du catalogue ne sont pas placées dans le même flux d'exécution que les migrations du cache V1.

## Structure cible

```text
migrations/
└── cache/
    ├── V001__create_schema_migrations.sql
    ├── V002__create_search_cache.sql
    ├── V003__create_content_cache.sql
    └── V004__remove_legacy_cache_tables.sql

catalog-migrations/
├── C001__create_catalog_schema.sql
├── C002__create_document_versions.sql
├── C003__create_document_sections.sql
├── C004__create_sync_tracking.sql
└── C005__create_fts_index.sql
```

La migration physique des fichiers V1 vers `migrations/cache/` peut être réalisée dans une phase d'implémentation dédiée si elle ne casse pas le packaging existant. Pendant V2.0, la décision est documentaire.

## Composants prévus

```text
CatalogDatabase
CatalogMigrationRunner
CatalogRepository
SqliteCatalogRepository
CatalogIndexRepository
CatalogMaintenanceService
```

## Règles

1. Le cache V1 ne référence jamais le catalogue V2.
2. Le catalogue V2 ne dépend jamais du contenu du cache V1.
3. Les outils V1 continuent d'utiliser uniquement `cache.db`.
4. Les futurs outils/resources V2 lisent uniquement `catalog.db`.
5. L'index FTS5 est dérivé du catalogue et peut être reconstruit.
6. La suppression de `cache.db` ne doit jamais supprimer un document catalogue.
7. La reconstruction de `catalog.db` doit être une opération explicite.

## Conséquences

### Positives

- Séparation forte entre cache supprimable et base métier.
- Sauvegarde/restauration plus claire.
- Tests de migration isolés.
- Risque de corruption croisée réduit.
- Conformité avec ADR-011.

### Négatives

- Deux connexions SQLite à gérer.
- Deux stratégies de maintenance.
- Documentation d'exploitation plus importante.

### Neutralisation

- Introduire un `CatalogDatabase` dédié.
- Écrire des tests garantissant qu'aucune table V2 n'apparaît dans `cache.db`.
- Écrire des tests garantissant qu'aucune table V1 n'est nécessaire dans `catalog.db`.
- Ajouter une commande CLI `catalog verify` avant toute synchronisation.

## Critères d'acceptation avant implémentation

- Schéma catalogue validé dans `docs/reference/catalog-schema-v2.md`.
- Runner de migration catalogue spécifié.
- Conventions de nommage `C001__...` validées.
- Tests de séparation cache/catalogue définis.
