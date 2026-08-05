# Schéma catalogue V2

## Statut

- **Phase historique d'introduction** : V2.11 — pagination et lectures ciblées
- **État courant** : schéma du candidat `1.1.0`; verdict de livraison dans
  [`docs/status/current-state.md`](../status/current-state.md)
- **Portée** : schéma implémenté par `C001` à `C008`
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

## Migrations appliquées

Le candidat `1.1.0` applique, dans cet ordre :

```text
C001__create_catalog_sources.sql
C002__create_documents.sql
C003__create_document_versions.sql
C004__create_document_sections.sql
C005__create_sync_tracking.sql
C006__create_document_section_fts.sql
C007__harden_revision_integrity.sql
C008__add_catalog_pagination_indexes.sql
```

Une migration appliquée reste immuable. Toute évolution du schéma reçoit le numéro suivant.

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

Index de parcours :

```sql
CREATE INDEX ix_documents_language_id ON documents(language, id);
CREATE INDEX ix_documents_source_language_status_id
  ON documents(source_id, language, status, id);
```

`C008` ajoute ces index après mesure des plans de requête. Les pages filtrées sont ordonnées par
`documents.id`, tandis que les lectures `sourceId`, `documentId` et `sectionId` utilisent les clés
primaires SQLite. Les filtres absents sont retirés du SQL généré afin de ne pas neutraliser les
index avec des prédicats `OR` paramétriques.

## `document_versions`

Stocke une version extraite d'un document.

| Colonne           | Type    | Contraintes | Description                     |
| ----------------- | ------- | ----------- | ------------------------------- |
| `id`              | INTEGER | PK          | Identifiant interne             |
| `document_id`     | INTEGER | FK NOT NULL | Document logique                |
| `version_label`   | TEXT    | NULL        | Version upstream si disponible  |
| `content_hash`    | TEXT    | NOT NULL    | SHA-256 du payload HTTP brut V2 |
| `etag`            | TEXT    | NULL        | Validateur HTTP                 |
| `last_modified`   | TEXT    | NULL        | Validateur HTTP                 |
| `published_at`    | INTEGER | NULL        | Date de publication             |
| `fetched_at`      | INTEGER | NOT NULL    | Date d'extraction               |
| `is_current`      | INTEGER | NOT NULL    | 0/1                             |
| `extraction_mode` | TEXT    | NOT NULL    | `static` ou `native-render`     |
| `content_type`    | TEXT    | NOT NULL    | Type de contenu réel            |
| `metadata_json`   | TEXT    | NOT NULL    | Métadonnées non structurantes   |

Contraintes :

```sql
UNIQUE(document_id, content_hash)
```

Règle : `commitDocumentRevision` désactive les versions précédentes et marque une seule version
courante dans la même transaction que les sections, l'index et le pointeur du document.

En V2, `content_hash` est calculé sur les octets du payload HTTP avant extraction. Un wrapper HTML
modifié peut donc créer une version même si le Markdown utile reste identique. Un éventuel hash du
contenu normalisé nécessite une migration ou un double hash et est explicitement reporté à V3.

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

La synchronisation écrit réellement ces aliases :

- `OLD_URL` quand l'URL canonique précédemment stockée est remplacée ;
- `REDIRECT` pour l'URL source d'une redirection permanente observée ;
- `CANONICAL` quand l'URL finale diffère de l'URL canonique extraite.

L'unicité `(document_id, url)` déduplique les observations. Une nouvelle observation conserve
`first_seen_at`, actualise `last_seen_at` et met à jour le type de l'alias.

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

Chaque dry-run ou synchronisation réelle crée d'abord une ligne `RUNNING`, sans date de fin et avec
des compteurs nuls. La clôture atomique n'accepte qu'une ligne encore `RUNNING`, exige une date de
fin postérieure au début et écrit un statut terminal. Les use cases actuels émettent `SUCCESS`,
`PARTIAL` ou `FAILED`. `CANCELLED` appartient au schéma mais n'est pas produit par le runtime
candidat.

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
SOURCE_UNAVAILABLE
CONTENT_HASH_CHANGED
```

Ces six types correspondent au runtime candidat. Les événements sont liés au `sync_run` courant :
`HTTP_404` et `HTTP_410` accompagnent les statuts non destructifs, `PERMANENT_REDIRECT` et
`CANONICAL_CHANGED` décrivent les changements d'URL, `SOURCE_UNAVAILABLE` trace un échec fournisseur
temporaire sans changer automatiquement le statut du document, et `CONTENT_HASH_CHANGED` accompagne
une nouvelle révision.

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
puis applique C007 et C008. Toute différence ultérieure de nom ou de checksum fait échouer
l'ouverture du catalogue ; une migration appliquée ne doit jamais être modifiée rétroactivement.

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

Sur une réponse HTTP `304`, une transaction :

1. mettre à jour `last_seen_at` ;
2. conserver la version courante ;
3. ne créer ni version ni section ;
4. persister les aliases et événements de redirection éventuels ;
5. mettre à jour l'URL canonique et le statut `REDIRECTED` seulement si une redirection permanente
   fournit une nouvelle cible.

Sur une réponse complète dont le hash est identique, le document et ses observations sont mis à
jour, la version courante est conservée et aucune nouvelle version n'est créée.

### Échec réseau

Pour un document existant, un `404` écrit `HTTP_404` et passe le document en `STALE`; un `410` écrit
`HTTP_410` et le passe en `REMOVED`. Une indisponibilité fournisseur écrit `SOURCE_UNAVAILABLE` sans
forcer le statut `UNAVAILABLE`. Dans tous les cas, la version et les sections courantes sont
conservées.

## Couverture de validation

- migration sur base vide ;
- migration répétée idempotente et détection d'une dérive de checksum ;
- ajout document + version + sections ;
- ajout d'un contenu identique sans doublon ;
- nouvelle version sur hash différent ;
- reconstruction FTS complète ;
- rollback sur échec d'écriture des sections ou du FTS ;
- ingestion immédiatement recherchable sans rebuild ;
- détection des sections FTS manquantes et des entrées orphelines ;
- suppression de `cache.sqlite` sans impact `catalog.db` ;
- absence de tables V2 dans `cache.sqlite` ;
- absence de dépendance au cache V1 ;
- lectures source, document et section par clé primaire sans chargement global ;
- pagination stable après ajout de nouveaux documents ;
- filtres SQL `sourceKey`, `language` et `status` avec comptage cohérent ;
- plan `documentsByLanguage` utilisant `ix_documents_language_id` ;
- refus d'une page supérieure à 50 éléments.
- cycle `RUNNING` vers un statut terminal sans double clôture ;
- touch `304` sans nouvelle version ;
- déduplication des aliases et persistance des six événements runtime.
