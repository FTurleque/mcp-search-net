# Synchronisation catalogue V2

## Statut

- **Couverture fonctionnelle** : V2.5 — synchronisation incrémentale et obsolescence.
- **Statut courant** : comportement implémenté dans le candidat `1.1.0`, encore soumis aux gates de
  livraison décrits dans [`docs/status/current-state.md`](../status/current-state.md).
- **Décisions liées** : ADR-011, ADR-014, ADR-016.

## Objectif

La synchronisation V2 alimente `catalog.db`, versionne les documents, maintient l'index documentaire
dans chaque transaction de révision et reste strictement hors des outils MCP mutables.

Elle est déclenchée par CLI ou worker dédié, jamais par un outil MCP librement appelable par le LLM.

## Principes

1. La synchronisation est déclenchée explicitement par CLI.
2. Les URLs restent soumises aux politiques SSRF existantes.
3. Aucune authentification Web, cookie, proxy ou script utilisateur n'est accepté.
4. Un échec réseau n'efface pas le dernier contenu valide.
5. Les versions sont créées uniquement quand le SHA-256 du payload HTTP téléchargé change.
6. Le catalogue est la source de vérité V2.
7. Les opérations mutables restent hors MCP.
8. Le traitement est séquentiel en V2 initiale pour faciliter le rate limiting et la reprise.
9. Une révision documentaire est atomique : document, version, sections, FTS et pointeur courant.

## Pipeline implémenté

```text
catalog-sources.yml
   ↓
PlanCatalogSync / SyncCatalogDocuments
   ↓
PublicUrlSecurityPolicy + SecureHttpGateway
   ↓
Crawl4aiContentFetcher
   ↓
CatalogRepository.commitDocumentRevision
   ↓
document + version + sections + FTS + current_version_id (transaction unique)
   ↓
aliases + staleness_events liés au sync_run
   ↓
SyncReport JSON
```

## CLI `catalog sync`

### Dry-run

```bash
catalog sync --dry-run --file config/catalog-sources.yml
```

Options :

```text
--source-key <key>     limite le plan à une source
```

Le dry-run planifie les sources/documents configurés sans fetch réseau. Il persiste néanmoins un
`sync_run` créé en `RUNNING`, puis clôturé en `SUCCESS` avec les compteurs du plan.

### Sync réel

```bash
catalog sync --file config/catalog-sources.yml --config config/application.yml
```

Options :

```text
--source-key <key>       limite la synchronisation à une source
--limit <n>              limite volontairement le nombre de documents traités
--rate-limit-ms <ms>     délai applicatif entre deux documents
--resume-after <cursor>  reprend après un document déjà traité
```

`--limit` est désormais optionnel. Sans `--limit`, la synchronisation traite tous les documents activés du périmètre sélectionné.

### Curseur de reprise

Format global :

```text
--resume-after <sourceKey>:<stableKey>
```

Format raccourci possible quand `--source-key` est fourni :

```text
--source-key nodejs-docs --resume-after fs
```

La reprise saute tous les documents jusqu'au curseur inclus et reprend au document suivant dans l'ordre du fichier `catalog-sources.yml`.

Si le curseur n'existe pas dans le périmètre sélectionné, la commande échoue explicitement pour éviter une resynchronisation silencieuse depuis le début.

## Rate limiting

La synchronisation V2 applique deux protections :

1. `SecureHttpGateway` conserve les protections réseau existantes : timeout, taille maximale, redirections, concurrence et délai minimum configuré.
2. `SyncCatalogDocuments` applique un délai applicatif séquentiel entre deux documents via `rateLimitMs`.

Priorité du délai applicatif :

```text
--rate-limit-ms <ms> > application.security.minimumDelayMs > 0
```

Le résultat JSON expose `rateLimitMs` pour rendre le comportement visible.

## Détection de changement

Le fetcher reçoit les validateurs de la version courante quand ils existent :

- `contentHash` ;
- `ETag` ;
- `Last-Modified`.

Décisions :

- réponse `notModified`/HTTP `304` => document `unchanged`, `last_seen_at` actualisé, aucune nouvelle
  version ni section ; une redirection permanente observée peut aussi actualiser l'URL canonique,
  le statut `REDIRECTED`, les aliases et les événements associés ;
- hash identique au contenu courant => document `unchanged`, aucune nouvelle version ;
- hash différent => révision atomique, immédiatement recherchable sans rebuild manuel ;
- redirection permanente => document `REDIRECTED`, `stableKey` conservé, chaîne de redirection
  stockée en métadonnées, aliases et événements persistés ;
- 404 sur document existant => document `STALE`, version courante conservée ;
- 410 sur document existant => document `REMOVED`, version courante conservée ;
- indisponibilité fournisseur sur un document existant => événement `SOURCE_UNAVAILABLE`, sans
  mutation destructive ni passage automatique en `UNAVAILABLE` ;
- autre erreur => entrée `failed`, run `FAILED` ou `PARTIAL` selon les autres documents.

Les observations écrites par la synchronisation sont :

- aliases `OLD_URL`, `REDIRECT` et `CANONICAL`, dédupliqués par document et URL ;
- événements `HTTP_404`, `HTTP_410`, `PERMANENT_REDIRECT`, `CANONICAL_CHANGED`,
  `SOURCE_UNAVAILABLE` et `CONTENT_HASH_CHANGED`.

Chaque observation référence le `sync_run` courant. Une réobservation d'alias conserve sa première
date et actualise sa dernière date.

Le `content_hash` V2 caractérise volontairement les octets HTTP, avant extraction. Cette sémantique
est compatible avec les versions déjà stockées et détecte toute modification upstream, mais elle
peut créer du churn lorsqu'un wrapper HTML change sans changement documentaire. Passer à un hash
du Markdown normalisé exige une stratégie de migration/double-hash pour les catalogues existants ;
ce changement est donc reporté explicitement à V3 et devra être comparé sur un corpus réel avant
adoption.

## Sortie JSON

Le sync réel retourne notamment :

```text
schemaVersion
dryRun
syncRun
checkedCount
addedCount
updatedCount
unchangedCount
failedCount
skippedCount
documents
rateLimitMs
limited
resumeAfter
index
```

`limited` vaut `true` quand `--limit` a empêché de traiter tous les documents restants. Le champ
`index.indexedSections` provient de la vérification post-sync ; le CLI ne masque plus une
incohérence en reconstruisant automatiquement tout l'index.

## Reprise après interruption

La reprise opérationnelle repose sur l'ordre déterministe de `catalog-sources.yml` et sur le dernier document visible dans le rapport JSON.

Exemple : si le dernier document traité est `nodejs-docs:fs`, relancer :

```bash
catalog sync --file config/catalog-sources.yml --resume-after nodejs-docs:fs
```

La commande reprend au document suivant.

## Politique de non-suppression

Un document existant ne perd jamais sa version courante à cause d'un échec réseau.

- `404` : document marqué `STALE`, sections conservées.
- `410` : document marqué `REMOVED`, sections conservées.
- erreurs temporaires : échec dans le rapport, pas de mutation destructive.

## Lifecycle et observabilité

Chaque dry-run ou sync réel écrit d'abord un `sync_run` en `RUNNING` avec compteurs nuls, puis le
clôt une seule fois avec :

- source ciblée si applicable ;
- date de début et de fin ;
- statut `SUCCESS`, `FAILED` ou `PARTIAL` ;
- compteurs ajoutés, mis à jour, inchangés et échoués ;
- résumé d'erreur si nécessaire.

Une exception qui interrompt la boucle clôt le run en `FAILED` avant d'être propagée. Le schéma
autorise aussi `CANCELLED`, mais aucun use case du candidat ne produit actuellement cet état.

## Tests couverts

- fetch et stockage d'un document ;
- sync exhaustive sans `--limit` ;
- rate limiting applicatif ;
- reprise via curseur ;
- validateurs de version courante ;
- contenu inchangé ;
- réponse `notModified` avec touch `last_seen_at` et absence de nouvelle version ;
- redirection permanente ;
- 404 non destructif ;
- 410 non destructif ;
- aliases dédupliqués et six types d'événements liés au run ;
- transition `RUNNING` vers un seul statut terminal ;
- index FTS mis à jour dans la transaction de chaque révision ;
- rollback des écritures si sections ou indexation échouent ;
- vérification post-sync sans rebuild correctif implicite.

## Limites courantes

- aucune découverte automatique ni crawl de domaine ;
- aucune mutation de synchronisation exposée par MCP ;
- aucun statut `CANCELLED` émis par les use cases actuels ;
- aucun hash de contenu normalisé en V2 : cette évolution est reportée à V3.
