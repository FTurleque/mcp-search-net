# Schéma catalogue V2

## Statut

- **Phase** : V2.9 — intégrité transactionnelle et migrations immuables
- **Portée** : schéma implémenté par `C001` à `C007`
- **Base cible** : `.data/catalog.db`
- **Décision liée** : ADR-014, ADR-015

## Principes

1. Le catalogue V2 est durable et distinct du cache V1.
2. Les tables V1 `search_cache` et `content_cache` ne sont jamais réutilisées.
3. L'index FTS5 est dérivé et reconstructible.
4. Les opérations de synchronisation sont transactionnelles par document.
5. Un échec réseau ne supprime jamais immédiatement un document.
6. Les URLs et contenus restent soumis aux règles SSRF V1.

## Vue d'ensemble

```text
catalog_sources
  └── documents
        ├── document_versions
        │     └── document_sections
        │            └── document_section_fts (index dérivé)
        ├── document_aliases
        └── staleness_events
sync_runs
```

## `catalog_sources`

Décrit une source documentaire gérée par le catalogue.

| Colonne            | Type    | Contraintes     | Description                                  |
| ------------------ | ------- | --------------- | -------------------------------------------- |
| `id`               | INTEGER | PK              | Identifiant interne                          |
| `source_key`       | TEXT    | UNIQUE NOT NULL | Clé stable, ex. `nodejs-docs`                |
| `display_name`     | TEXT    | NOT NULL        | Nom lisible                                  |
| `base_url`         | TEXT    | NOT NULL        | URL racine publique                          |
| `source_type`      | TEXT    | NOT NULL        | `documentation`, `reference`, `api`, `guide` |
| `language`         | TEXT    | NOT NULL        | Langue par défaut                            |
| `freshness_policy` | TEXT    | NOT NULL        | `manual`, `daily`, `weekly`, `monthly`       |
| `sync_strategy`    | TEXT    | NOT NULL        | `manual`, `polling`                          |
| `enabled`          | INTEGER | NOT NULL        | 0/1                                          |
| `created_at`       | INTEGER | NOT NULL        | Epoch ms                                     |
| `updated_at`       | INTEGER | NOT NULL        | Epoch ms                                     |

Index :

```sql
CREATE UNIQUE INDEX ux_catalog_sources_source_key ON catalog_sources(source_key);
CREATE INDEX ix_catalog_sources_enabled ON catalog_sources(enabled);
```

## `documents`

Représente un document logique, indépendamment de ses versions.

| Colonne              | Type    | Contraintes                               | Description                                               |
| -------------------- | ------- | ----------------------------------------- | --------------------------------------------------------- |
| `id`                 | INTEGER | PK                                        | Identifiant interne                                       |
| `public_id`          | TEXT    | UNIQUE NOT NULL                           | Identifiant stable exposable                              |
| `source_id`          | INTEGER | FK NOT NULL                               | Source                                                    |
| `canonical_url`      | TEXT    | NOT NULL                                  | URL canonique courante                                    |
| `stable_key`         | TEXT    | NOT NULL                                  | Clé stable par source                                     |
| `title`              | TEXT    | NOT NULL                                  | Titre courant                                             |
| `mime_type`          | TEXT    | NOT NULL                                  | Type de contenu courant                                   |
| `language`           | TEXT    | NOT NULL                                  | Langue détectée ou source                                 |
| `status`             | TEXT    | NOT NULL                                  | `ACTIVE`, `STALE`, `REDIRECTED`, `REMOVED`, `UNAVAILABLE` |
| `current_version_id` | INTEGER | NULL, invariant protégé par triggers C007 | Version courante                                          |
| `first_seen_at`      | INTEGER | NOT NULL                                  | Première observation                                      |
| `last_seen_at`       | INTEGER | NOT NULL                                  | Dernière observation                                      |
| `created_at`         | INTEGER | NOT NULL                                  | Création locale                                           |
| `updated_at`         | INTEGER | NOT NULL                                  | Mise à jour locale                                        |

Contraintes :

```sql
UNIQUE(source_id, stable_key)
UNIQUE(source_id, canonical_url)
```

## `document_versions`

Stocke une version extraite d'un document.

| Colonne           | Type    | Contraintes | Description                    |
| ----------------- | ------- | ----------- | ------------------------------ |
| `id`              | INTEGER | PK          | Identifiant interne            |
| `document_id`     | INTEGER | FK NOT NULL | Document logique               |
| `version_label`   | TEXT    | NULL        | Version upstream si disponible |
| `content_hash`    | TEXT    | NOT NULL    | Hash du contenu normalisé      |
| `etag`            | TEXT    | NULL        | Validateur HTTP                |
| `last_modified`   | TEXT    | NULL        | Validateur HTTP                |
| `published_at`    | INTEGER | NULL        | Date de publication            |
| `fetched_at`      | INTEGER | NOT NULL    | Date d'extraction              |
| `is_current`      | INTEGER | NOT NULL    | 0/1                            |
| `extraction_mode` | TEXT    | NOT NULL    | `static` ou `native-render`    |
| `content_type`    | TEXT    | NOT NULL    | Type de contenu réel           |
| `metadata_json`   | TEXT    | NOT NULL    | Métadonnées non structurantes  |

Contraintes :

```sql
UNIQUE(document_id, content_hash)
```

Règle : `commitDocumentRevision` désactive les versions précédentes et marque une seule version
courante dans la même transaction que les sections, l'index et le pointeur du document.

## `document_sections`

Stocke les sections exploitables pour recherche et lecture.

| Colonne               | Type    | Contraintes | Description                  |
| --------------------- | ------- | ----------- | ---------------------------- |
| `id`                  | INTEGER | PK          | Identifiant interne          |
| `document_version_id` | INTEGER | FK NOT NULL | Version                      |
| `ordinal`             | INTEGER | NOT NULL    | Ordre documentaire           |
| `heading`             | TEXT    | NULL        | Titre de section             |
| `heading_path`        | TEXT    | NULL        | Chemin hiérarchique          |
| `heading_level`       | INTEGER | NULL        | Niveau Markdown/HTML         |
| `anchor`              | TEXT    | NULL        | Ancre source                 |
| `content`             | TEXT    | NOT NULL    | Markdown nettoyé             |
| `content_hash`        | TEXT    | NOT NULL    | Hash de section              |
| `character_count`     | INTEGER | NOT NULL    | Taille caractères            |
| `token_count`         | INTEGER | NULL        | Estimation token facultative |

Contraintes :

```sql
UNIQUE(document_version_id, ordinal)
UNIQUE(document_version_id, content_hash)
```

## `document_aliases`

Conserve les anciennes URLs et redirections.

| Colonne         | Type    | Contraintes | Description                        |
| --------------- | ------- | ----------- | ---------------------------------- |
| `id`            | INTEGER | PK          | Identifiant interne                |
| `document_id`   | INTEGER | FK NOT NULL | Document                           |
| `url`           | TEXT    | NOT NULL    | URL alias                          |
| `alias_type`    | TEXT    | NOT NULL    | `OLD_URL`, `REDIRECT`, `CANONICAL` |
| `first_seen_at` | INTEGER | NOT NULL    | Première observation               |
| `last_seen_at`  | INTEGER | NOT NULL    | Dernière observation               |

Contraintes :

```sql
UNIQUE(document_id, url)
```

## `sync_runs`

Trace les synchronisations.

| Colonne               | Type    | Contraintes | Description                                            |
| --------------------- | ------- | ----------- | ------------------------------------------------------ |
| `id`                  | INTEGER | PK          | Identifiant interne                                    |
| `source_id`           | INTEGER | FK NULL     | Source ciblée ou toutes sources                        |
| `started_at`          | INTEGER | NOT NULL    | Début                                                  |
| `completed_at`        | INTEGER | NULL        | Fin                                                    |
| `status`              | TEXT    | NOT NULL    | `RUNNING`, `SUCCESS`, `PARTIAL`, `FAILED`, `CANCELLED` |
| `documents_checked`   | INTEGER | NOT NULL    | Nombre de documents vérifiés                           |
| `documents_added`     | INTEGER | NOT NULL    | Ajouts                                                 |
| `documents_updated`   | INTEGER | NOT NULL    | Mises à jour                                           |
| `documents_unchanged` | INTEGER | NOT NULL    | Inchangés                                              |
| `documents_failed`    | INTEGER | NOT NULL    | Échecs                                                 |
| `error_summary`       | TEXT    | NULL        | Résumé court                                           |

## `staleness_events`

Trace les événements de fraîcheur ou d'obsolescence.

| Colonne        | Type    | Contraintes | Description         |
| -------------- | ------- | ----------- | ------------------- |
| `id`           | INTEGER | PK          | Identifiant interne |
| `document_id`  | INTEGER | FK NOT NULL | Document            |
| `sync_run_id`  | INTEGER | FK NULL     | Run associé         |
| `event_type`   | TEXT    | NOT NULL    | Type d'événement    |
| `observed_at`  | INTEGER | NOT NULL    | Date                |
| `details_json` | TEXT    | NOT NULL    | Détails contrôlés   |

Types d'événement :

```text
HTTP_404
HTTP_410
PERMANENT_REDIRECT
CANONICAL_CHANGED
FRESHNESS_EXPIRED
SOURCE_UNAVAILABLE
CONTENT_HASH_CHANGED
```

## `document_section_fts`

Index FTS5 dérivé.

```sql
CREATE VIRTUAL TABLE document_section_fts USING fts5(
  section_id UNINDEXED,
  document_id UNINDEXED,
  source_key UNINDEXED,
  language UNINDEXED,
  title,
  heading,
  heading_path,
  content,
  content = '',
  contentless_delete = 1,
  tokenize = 'unicode61 remove_diacritics 2'
);
```

Règle de correspondance :

```text
document_section_fts.rowid = document_sections.id
```

Colonnes :

- `title` : titre document ;
- `heading` : titre de section ;
- `heading_path` : chemin hiérarchique ;
- `content` : texte Markdown de la section.

Les colonnes `UNINDEXED` servent à alimenter l'index mais ne sont pas relues depuis la table
contentless. Les jointures applicatives utilisent toujours `rowid`.

## Registre des migrations

`catalog_schema_migrations` stocke `version`, `name`, `applied_at` et `checksum`. Le checksum est un
SHA-256 du SQL avec fins de ligne normalisées. Pour un registre C001-C006 antérieur à V2.9, le
runner ajoute la colonne et établit une seule fois la baseline depuis les migrations embarquées,
puis applique C007. Toute différence ultérieure de nom ou de checksum fait échouer l'ouverture du
catalogue ; une migration appliquée ne doit jamais être modifiée rétroactivement.

## Transactions

### Ajout d'un document

Une transaction doit :

1. insérer ou mettre à jour `documents` sans changer le pointeur courant ;
2. retirer de l'index les lignes antérieures du document ;
3. désactiver l'ancienne version courante ;
4. insérer ou réutiliser `document_versions` ;
5. remplacer `document_sections` ;
6. alimenter `document_section_fts` pour la nouvelle version ;
7. mettre à jour `documents.current_version_id` en dernier ;
8. committer l'ensemble, ou tout annuler à la première erreur.

### Synchronisation sans changement

Une transaction doit :

1. mettre à jour `last_seen_at` ;
2. conserver la version courante ;
3. réindexer la version courante seulement si les métadonnées ou le statut du document sont mis à jour.

### Échec réseau

Une transaction doit :

1. ajouter un `staleness_event` ;
2. mettre le document en `STALE` ou `UNAVAILABLE` selon politique ;
3. ne pas supprimer le contenu existant.

## Tests à prévoir

- migration sur base vide ;
- migration répétée idempotente et détection d'une dérive de checksum ;
- ajout document + version + sections ;
- ajout d'un contenu identique sans doublon ;
- nouvelle version sur hash différent ;
- reconstruction FTS complète ;
- rollback sur échec d'écriture des sections ou du FTS ;
- ingestion immédiatement recherchable sans rebuild ;
- détection des sections FTS manquantes et des entrées orphelines ;
- suppression de `cache.db` sans impact `catalog.db` ;
- absence de tables V2 dans `cache.db` ;
- absence de dépendance au cache V1.
