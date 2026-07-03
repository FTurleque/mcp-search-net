# Synchronisation catalogue V2

## Statut

- **Phase** : V2.0 — étude et cadrage
- **Portée** : conception, aucune implémentation runtime dans cette phase
- **Décisions liées** : ADR-011, ADR-014, ADR-016

## Objectif

Définir une stratégie de synchronisation documentaire locale, sûre et non destructive, sans exposer les opérations de mutation comme outils MCP librement appelables par le LLM.

La synchronisation V2 doit alimenter `catalog.db`, versionner les documents et reconstruire l'index FTS5 sans modifier les contrats V1.

## Principes

1. La synchronisation est déclenchée par CLI ou worker dédié, pas par un outil MCP public libre.
2. Les URLs restent soumises aux politiques SSRF existantes.
3. Aucune authentification Web, cookie, proxy ou script utilisateur n'est accepté.
4. Un échec réseau n'efface pas le dernier contenu valide.
5. Les versions sont créées uniquement quand le contenu normalisé change.
6. Le cache V1 peut être utilisé comme optimisation interne uniquement si cela ne devient jamais une dépendance métier.
7. Le catalogue est la source de vérité V2.

## Pipeline cible

```text
CatalogSource
   ↓
SyncPlanner
   ↓
UrlSecurityPolicy
   ↓
ContentFetcher / Crawl4AI
   ↓
DocumentNormalizer
   ↓
VersionDetectionService
   ↓
CatalogRepository
   ↓
CatalogIndexer
   ↓
SyncReport
```

## Réutilisation V1 autorisée

La V2 peut réutiliser des services internes V1 :

```text
UrlSecurityPolicy
DnsResolver
ContentFetcher
Content parser / Markdown section parser
Logger
Clock
Telemetry
```

Elle ne doit pas appeler l'outil MCP public `fetch_url` depuis le pipeline de synchronisation.

Motif : un outil MCP est une interface externe. La V2 doit appeler les services applicatifs ou ports internes pour garder la synchronisation testable, transactionnelle et indépendante du protocole MCP.

## Sources catalogue

Les sources synchronisables sont définies dans :

```text
config/catalog-sources.yml
```

Exemple conceptuel :

```yaml
schema_version: 1

sources:
  nodejs-docs:
    display_name: Node.js Documentation
    base_url: https://nodejs.org/api/
    language: en-US
    freshness_policy: weekly
    sync_strategy: manual
    seeds:
      - https://nodejs.org/api/fs.html
      - https://nodejs.org/api/path.html
```

`official-sources.yml` reste le registre de confiance. `catalog-sources.yml` décrit l'exploitation documentaire.

## Découverte des documents

V2.0 ne valide pas de crawl autonome.

Stratégies autorisées en V2 initiale :

1. seeds explicites ;
2. fichiers manifestes officiels si disponibles ;
3. liste maintenue dans `catalog-sources.yml` ;
4. ajout manuel par CLI.

Stratégies hors périmètre initial :

- crawl complet de domaine ;
- profondeur automatique ;
- découverte par navigation JavaScript ;
- authentification ;
- formulaires.

## CLI cible

```text
mcp-search-net catalog init
mcp-search-net catalog add-source
mcp-search-net catalog sync
mcp-search-net catalog status
mcp-search-net catalog rebuild-index
mcp-search-net catalog verify
mcp-search-net catalog purge-versions
```

### `catalog init`

- crée `catalog.db` si absent ;
- applique les migrations catalogue ;
- vérifie l'absence de tables V2 dans `cache.db`.

### `catalog add-source`

- valide une entrée de source ;
- n'effectue pas de fetch automatique sauf option explicite future ;
- refuse les URLs privées.

### `catalog sync`

Options à cadrer :

```text
--source <sourceKey>
--document <documentPublicId>
--all
--dry-run
--max-documents <n>
--timeout-ms <n>
```

Règles :

- un seul writer catalogue à la fois ;
- lock applicatif ;
- rapport `sync_runs` ;
- transaction par document ;
- reprise possible après interruption.

### `catalog status`

- liste sources ;
- nombre de documents ;
- dernière synchronisation ;
- documents stale ;
- taille index.

### `catalog rebuild-index`

- reconstruit `document_sections_fts` depuis `document_sections` ;
- ne refetch aucun document ;
- produit un rapport de cohérence.

### `catalog verify`

- vérifie intégrité SQLite ;
- vérifie cohérence documents/versions/sections ;
- vérifie cohérence FTS ;
- vérifie séparation cache/catalogue.

## Détection de changement

Ordre de décision :

1. URL finale/canonique changée ;
2. HTTP status durable `404` ou `410` ;
3. ETag différent ;
4. Last-Modified différent ;
5. hash du contenu normalisé différent ;
6. version explicite upstream différente.

Une nouvelle `document_version` est créée si le contenu normalisé change.

Une redirection permanente peut créer ou mettre à jour `document_aliases`.

Un échec temporaire crée un `staleness_event` sans supprimer les sections existantes.

## Politique de non-suppression

Un document ne passe pas directement à `REMOVED` après un seul échec.

Proposition :

```text
1er échec temporaire   -> STALE + staleness_event
3 échecs consécutifs   -> UNAVAILABLE
HTTP 410 confirmé      -> REMOVED après confirmation ou délai de grâce
redirection permanente -> REDIRECTED puis ACTIVE sur canonical_url mise à jour
```

Les seuils exacts seront configurables.

## Rate limiting

Valeurs initiales proposées :

```text
maxDocumentsPerRun = 100
minDelayBetweenRequestsMs = 1000
maxConcurrentFetches = 1 en V2 initiale
timeoutPerDocumentMs = 20000
maxDocumentBytes = limite V1 existante ou plus stricte
```

La V2 initiale privilégie la politesse réseau et la reproductibilité plutôt que la vitesse.

## Observabilité

Événements structurés :

```text
catalog_sync_started
catalog_sync_completed
catalog_sync_failed
catalog_document_checked
catalog_document_added
catalog_document_updated
catalog_document_unchanged
catalog_document_failed
catalog_index_rebuilt
catalog_verify_completed
```

Chaque run a un `syncRunId`.

Ne jamais logger :

- corps documentaire complet ;
- token ;
- variables d'environnement complètes ;
- stack trace brute dans les réponses utilisateur.

## Tests à prévoir

- sync dry-run ;
- ajout source valide ;
- refus URL privée ;
- document inchangé ;
- document changé ;
- redirection permanente ;
- 404 temporaire ;
- 410 confirmé ;
- interruption au milieu d'un run ;
- reprise ;
- rebuild index ;
- verify ;
- zéro régression V1.

## Sorties de phase attendues

La phase d'implémentation V2.3 sera considérée prête si :

- le modèle de données est validé ;
- le runner de migrations catalogue existe ;
- le CLI skeleton est défini ;
- les tests de sécurité SSRF peuvent être réutilisés ;
- le pipeline n'appelle pas les outils MCP publics V1.
