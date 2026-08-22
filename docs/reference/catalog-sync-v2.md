# Synchronisation catalogue V2

## Statut

- **Couverture fonctionnelle** : V2.5 — synchronisation incrémentale et obsolescence.
- **Statut courant** : comportement implémenté dans la série `1.1.x`, soumis aux gates de livraison
  décrits dans [`docs/status/current-state.md`](../status/current-state.md).
- **Décisions liées** : ADR-011, ADR-014, ADR-016.

## Objectif

La synchronisation V2 alimente `catalog.db`, versionne les documents, maintient l'index documentaire
dans chaque transaction de révision et reste strictement hors des outils MCP mutables.

Elle est déclenchée par CLI ou worker dédié, jamais par un outil MCP librement appelable par le LLM.

## Principes

1. La synchronisation est déclenchée explicitement par CLI.
2. Les URLs restent soumises aux politiques SSRF existantes et leur query string de transport n'est
   pas réécrite avant le fetch.
3. Aucune authentification Web, cookie, proxy ou script utilisateur n'est accepté.
4. Un échec réseau n'efface pas le dernier contenu valide.
5. Les versions sont créées uniquement quand le SHA-256 du payload HTTP téléchargé change.
6. Le catalogue est la source de vérité V2.
7. Les opérations mutables restent hors MCP.
8. Le traitement est séquentiel en V2 initiale pour faciliter le rate limiting et la reprise.
9. Une révision documentaire est atomique : document, version, sections, FTS et pointeur courant.
10. Une section persistée est bornée à 12 000 caractères ; les sections plus longues sont découpées
    avec un overlap borné avant écriture SQLite/FTS5.

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
section chunking borné
   ↓
document + version + sections + FTS + current_version_id (transaction unique)
   ↓
aliases + staleness_events liés au sync_run
   ↓
SyncReport JSON
```

## Réconciliation des sources

`catalog load-sources --file config/catalog-sources.yml` est déclaratif :

- une source absente est créée (`created`) ;
- une source déjà identique est laissée intacte (`skipped`) ;
- une source dont `displayName`, `baseUrl`, type, langue, politique de fraîcheur, stratégie de sync ou
  état `enabled` a changé est mise à jour en place (`updated`).

Chaque `stable_key` doit être unique à l'intérieur de sa source. Un doublon est rejeté pendant le
parsing de `catalog-sources.yml`, avant ouverture ou migration du fichier `catalog.db` sur les chemins
`load-sources` et `sync`. Deux déclarations ne peuvent donc pas converger silencieusement vers la
même identité documentaire durable.

Quand au moins une source existante est réconciliée, l'index FTS dérivé est reconstruit une fois afin
qu'un changement de `enabled` soit immédiatement reflété dans la recherche locale.

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
`sync_run` de type `PLAN`, créé en `RUNNING`, puis clôturé en `CANCELLED` avec les compteurs
d'exécution à zéro et `errorSummary = DRY_RUN_PLAN`. Les compteurs `planned*` / `skipped*` restent
dans la sortie du plan et ne sont pas mélangés aux métriques d'exécution. `dry-run` signifie ici
« aucune mutation des documents/versions/sections », et non « aucune écriture d'audit ».

### Sync réel

```bash
catalog sync --file config/catalog-sources.yml --config config/application.yml
```

Options :

```text
--source-key <key>          limite la synchronisation à une source
--limit <n>                 limite volontairement le nombre de documents traités
--rate-limit-ms <ms>        délai applicatif entre deux documents
--resume-after <cursor>     reprend après un document déjà traité
--resume-fingerprint <sha>  lie le curseur à la configuration qui l'a produit
```

`--limit` est optionnel. Sans `--limit`, la synchronisation traite tous les documents activés du
périmètre sélectionné.

### Curseur de reprise

Format global :

```text
--resume-after <sourceKey>:<stableKey> --resume-fingerprint <sha256>
```

Format raccourci possible quand `--source-key` est fourni :

```text
--source-key nodejs-docs --resume-after fs --resume-fingerprint <sha256>
```

Le curseur n'est jamais accepté seul. Quand `limited = true`, le rapport émet ensemble :

- `resumeAfter`, calculé à partir du **dernier document réellement sélectionné pour ce lot** ;
- `resumeConfigurationFingerprint`, SHA-256 de la séquence effective des documents activés dans le
  périmètre de synchronisation.

L'appel suivant doit réinjecter les deux valeurs. Avant de créer un nouveau `sync_run`,
`SyncCatalogDocuments` recalcule l'empreinte de la configuration courante. Une modification, un
réordonnancement ou un changement de métadonnées documentaires fait échouer la reprise avec
`CATALOG_RESUME_CONFIGURATION_CHANGED` au lieu de sauter ou retraiter silencieusement des documents.

Si le curseur d'entrée n'existe pas dans le périmètre sélectionné, la commande échoue également
explicitement. `--resume-fingerprint` sans `--resume-after`, ou l'inverse, est rejeté par le CLI avant
ouverture du catalogue.

## Rate limiting et budgets réseau

La synchronisation V2 applique plusieurs protections :

1. `SecureHttpGateway` conserve les protections réseau : deadline wall-clock absolue, taille maximale
   cumulée de la ressource, redirections bornées, concurrence et délai minimum configuré ;
2. les bodies 3xx/304 non utilisés ne sont pas bufferisés ;
3. `SyncCatalogDocuments` applique un délai applicatif séquentiel entre deux documents via
   `rateLimitMs`.

Priorité du délai applicatif :

```text
--rate-limit-ms <ms> > application.security.minimumDelayMs > 0
```

Le résultat JSON expose `rateLimitMs` pour rendre le comportement visible.

## Détection de changement

Le fetcher reçoit les validateurs de la version courante quand ils existent :

- `contentHash` ;
- `ETag` ;
- `Last-Modified` ;
- l'URL de représentation `finalUrl` issue des métadonnées de version, quand elle est disponible.

`ETag` et `Last-Modified` ne sont envoyés que lorsque cette URL de représentation correspond
exactement à l'URL transport demandée. Ils ne sont jamais propagés vers une cible de redirection.
Une ancienne version sans `finalUrl` exploitable reste sûre : elle est simplement rechargée sans
requête conditionnelle.

Décisions :

- réponse `notModified`/HTTP `304` => document `unchanged`, `last_seen_at` actualisé, aucune nouvelle
  version ni section ; une redirection permanente observée peut aussi actualiser l'URL canonique,
  le statut `REDIRECTED`, les aliases et les événements associés ;
- hash identique au contenu courant => document `unchanged`, aucune nouvelle version ;
- hash différent => révision atomique, immédiatement recherchable sans rebuild manuel ;
- la destination permanente de l'URL d'origine est calculée uniquement à partir du **préfixe
  contigu de redirections permanentes** : une redirection temporaire (`302`/`307`) coupe cette
  relation. Ainsi `301 -> 302` conserve la cible du `301` comme identité permanente, tandis que
  `302 -> 301` ne rend pas l'URL d'origine permanente ;
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

## Sections persistées et FTS5

Avant `commitDocumentRevision`, le repository borne chaque section persistée à 12 000 caractères.
Une section plus longue est découpée avec un overlap de 400 caractères, reçoit des ordinaux
séquentiels et des ancres de partie déterministes. Chaque occurrence est conservée : des chunks
identiques à deux positions différentes, ou une petite section identique au chunk d’une grande
section, peuvent partager un SHA-256 sans être dédupliqués.

Cette règle s'applique à la synchronisation réseau comme à l'ingestion CLI et borne la quantité de
texte traitée par une entrée FTS5 individuelle.

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
resumeConfigurationFingerprint
index
```

`limited` vaut `true` quand `--limit` a empêché de traiter tous les documents restants. Dans ce cas,
`resumeAfter` contient le dernier document sélectionné pour le lot et
`resumeConfigurationFingerprint` l'empreinte à réinjecter avec ce curseur. Le champ
`index.indexedSections` provient de la vérification post-sync ; le CLI ne masque plus une incohérence
en reconstruisant automatiquement tout l'index.

## Reprise après interruption

Pour un lot limité, conserver **les deux champs** `resumeAfter` et
`resumeConfigurationFingerprint` renvoyés par le rapport JSON.

Exemple : si le rapport renvoie `resumeAfter = nodejs-docs:fs` et une empreinte `abc...`, relancer :

```bash
catalog sync --file config/catalog-sources.yml \
  --resume-after nodejs-docs:fs \
  --resume-fingerprint <resumeConfigurationFingerprint>
```

La commande reprend au document suivant uniquement si la configuration effective est identique à
celle qui a produit le curseur. Toute dérive de configuration est fail-closed et impose de relancer
une synchronisation sans ancien curseur.

## Politique de non-suppression

Un document existant ne perd jamais sa version courante à cause d'un échec réseau.

- `404` : document marqué `STALE`, sections conservées.
- `410` : document marqué `REMOVED`, sections conservées.
- erreurs temporaires : échec dans le rapport, pas de mutation destructive.

## Lifecycle et observabilité

Chaque dry-run ou sync réel écrit d'abord un `sync_run` en `RUNNING` avec compteurs nuls, puis le
clôt une seule fois :

- un run d'exécution (`runKind = EXECUTION`) termine en `SUCCESS`, `FAILED` ou `PARTIAL` avec ses
  compteurs ajoutés, mis à jour, inchangés et échoués ;
- un dry-run (`runKind = PLAN`) termine en `CANCELLED`, conserve les compteurs d'exécution à zéro et
  porte `errorSummary = DRY_RUN_PLAN` ; les compteurs de planification restent dans la sortie du
  use case ;
- la source ciblée et les dates de début/fin sont conservées dans les deux cas.

Une exception qui interrompt la boucle d'une exécution clôt le run en `FAILED` avant d'être propagée.
`CANCELLED` est donc actuellement utilisé de manière déterministe pour identifier les dry-runs de
type `PLAN`, et peut être distingué d'une exécution réelle via `runKind`.

## Tests couverts

- fetch et stockage d'un document ;
- conservation exacte de la query string de transport ;
- sync exhaustive sans `--limit` ;
- rate limiting applicatif ;
- reprise via curseur + empreinte et continuation calculée pour un lot limité ;
- rejet avant démarrage du run si l'ordre ou la configuration ayant produit le curseur a changé ;
- rejet des `stable_key` dupliqués avant ouverture du catalogue ;
- validateurs de version courante liés à leur URL de représentation ;
- contenu inchangé ;
- réponse `notModified` avec touch `last_seen_at` et absence de nouvelle version ;
- redirection permanente et chaînes mixtes permanente/temporaire ;
- 404 non destructif ;
- 410 non destructif ;
- aliases dédupliqués et six types d'événements liés au run ;
- transition `RUNNING` vers un seul statut terminal ;
- dry-run `PLAN -> CANCELLED` distinct des métriques d'exécution ;
- index FTS mis à jour dans la transaction de chaque révision ;
- chunking borné des sections surdimensionnées ;
- rollback des écritures si sections ou indexation échouent ;
- vérification post-sync sans rebuild correctif implicite.

## Limites courantes

- aucune découverte automatique ni crawl de domaine ;
- aucune mutation de synchronisation exposée par MCP ;
- aucun hash de contenu normalisé en V2 : cette évolution est reportée à V3.
