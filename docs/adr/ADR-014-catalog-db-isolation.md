# ADR-014 — Isoler le catalogue V2 dans `catalog.db`

- **Statut** : Accepté et implémenté dans le candidat `1.1.0`
- **Date** : 2026-07-03
- **Réconciliation courante** : 2026-08-04
- **Décision liée** : ADR-006, ADR-011

## Contexte

La V1 utilise SQLite comme cache opportuniste. Ce cache est soumis à TTL, peut être purgé et sert uniquement les outils `search_web` et `fetch_url`.

L'ADR-011 interdit de transformer `search_cache` ou `content_cache` en index métier V2. La V2 doit introduire un catalogue documentaire durable, versionné et reconstructible.

Le mécanisme de migration V1 actuel applique les migrations du cache à la base ouverte par le repository de cache. Mélanger des migrations V2 dans ce flux augmenterait le risque de créer des tables métier dans la base opportuniste.

## Décision

La V2 utilise une base SQLite distincte :

```text
.data/cache.sqlite -> cache opportuniste V1, supprimable
.data/catalog.db  -> catalogue documentaire V2, durable
```

Le catalogue V2 dispose de son propre runner de migrations, de sa propre connexion SQLite, de ses propres repositories et de ses propres tests d'intégration.

Les migrations du catalogue ne sont pas placées dans le même flux d'exécution que les migrations du cache V1.

## Structure implémentée

```text
migrations/
├── V001__create_schema_migrations.sql
├── V002__create_search_cache.sql
├── V003__create_content_cache.sql
└── V004__remove_legacy_cache_tables.sql

catalog-migrations/
├── C001__create_catalog_sources.sql
├── C002__create_documents.sql
├── C003__create_document_versions.sql
├── C004__create_document_sections.sql
├── C005__create_sync_tracking.sql
├── C006__create_document_section_fts.sql
├── C007__harden_revision_integrity.sql
└── C008__add_catalog_pagination_indexes.sql
```

Les deux runners sont séparés. Le registre catalogue conserve le nom et le checksum SHA-256
normalisé de chaque migration ; une migration appliquée n'est jamais réécrite.

## Composants implémentés

```text
openCatalogDatabase
CatalogMigrationRunner
CatalogRepository
SqliteCatalogRepository
SqliteCatalogMaintenance
```

Le runtime ouvre les deux repositories et les ferme au shutdown. `MCP_CATALOG_PATH` permet de
pointer le serveur vers un catalogue restauré ; le chargeur résout le chemin et refuse qu'il cible le
même fichier que le cache.

## Règles

1. Le cache V1 ne référence jamais le catalogue V2.
2. Le catalogue V2 ne dépend jamais du contenu du cache V1.
3. Les outils V1 continuent d'utiliser uniquement `cache.sqlite`.
4. Les outils/resources V2 lisent uniquement `catalog.db`.
5. L'index FTS5 est dérivé du catalogue et peut être reconstruit.
6. La suppression de `cache.sqlite` ne doit jamais supprimer un document catalogue.
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

- Ouverture dédiée par `openCatalogDatabase` et runner catalogue séparé.
- Tests garantissant qu'aucune table V2 n'apparaît dans `cache.sqlite` et qu'aucune table V1 n'est
  nécessaire dans `catalog.db`.
- Commande CLI `catalog verify` disponible pour le contrôle d'intégrité.

## Réalisation et validation

- Schéma `C001` à `C008` décrit dans `docs/reference/catalog-schema-v2.md`.
- Runner catalogue séparé, idempotent et protégé par checksum.
- Tests de séparation physique cache/catalogue, y compris chemins configurés dans des répertoires
  distincts.
- Suppression du cache sans suppression du catalogue.

Ces propriétés sont présentes dans le code candidat. Les validations historiques ne remplacent pas
les gates exact-head listés dans [`docs/status/current-state.md`](../status/current-state.md).
