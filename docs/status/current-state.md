# État courant de `mcp-search-net`

Ce document décrit l’état **fonctionnel et architectural autoritatif** du produit courant : contrat
MCP, stockage, migrations, sécurité, invariants de concurrence, packaging et politique de
qualification. Les fichiers datés sous `docs/planning/` restent des preuves historiques.

Les SHA de merge et les exécutions CI exact-head sont des **preuves GitHub datées** : ils ne sont pas
utilisés comme identité auto-référente de ce fichier, car tout commit modifiant ce document crée par
définition un nouveau SHA. L’issue #73 reste le tracker de clôture pour les preuves manuelles de
certification native.

## Version et branches

- Version SemVer : `1.1.3`.
- Branche de release et source de vérité publiée : `master`.
- Branche d’intégration courante : `develop`.
- Une capacité présente uniquement sur `develop` n’est pas déclarée publiée tant qu’elle n’a pas été
  portée sur `master` par le flux de release.
- Dernière baseline post-merge intégrée : merge de la PR #101 dans `develop`, commit
  `893fef0b64b16d8e3c9ca6c859a389b30d0af1fd`, tree fonctionnel
  `d883ad0381ac14b00261812cbc3c4dba25b2bc88`. La CI #1252 / `31911224166` a terminé en `SUCCESS`
  sur ce SHA pour Node.js, Docker/live E2E et Windows installation/STDIO packaging ; le job Sonar
  GitHub Actions est ignoré sur les pushes `develop` par conception.
- Le même tree avait été qualifié sur le head exact de la PR #101
  `d6f2ed20264fc40ae53adb3eb1b31b5c7284d027` par la CI #1251 / `31910100257`, avec
  `SonarCloud Code Analysis` en succès et le Quality Gate SonarQubeCloud passé : 0 nouvelle issue,
  0 Security Hotspot, 100 % de couverture sur le nouveau code et 0 % de duplication.
- La PR #102 porte le hardening post-audit suivant sur une branche dédiée et reste volontairement
  draft/non mergée jusqu’à qualification et instruction explicite d’intégration.
- Le ruleset `Protect integration branches` protège la branche par défaut et `develop`, exige les PR,
  la résolution des threads et les quatre checks courants. Le mode strict est actif : une PR doit
  être à jour avec sa base avant merge (`strict_required_status_checks_policy=true`).
- La politique SemVer de release impose l’égalité entre paramètre de publication, `package.json`,
  `package-lock.json` et version embarquée ; toute dérive bloque la publication.

## Findings post-audit fermés dans le code courant

- Les synchronisations catalogue `EXECUTION` incompatibles sont exclues durablement par SQLite via
  `C014__guard_concurrent_sync_execution.sql`. Une exécution globale exclut toute autre exécution ;
  deux exécutions ciblées sur la même source s’excluent ; deux sources différentes et les runs
  `PLAN` peuvent coexister.
- Le fencing du `syncRunId` et la promotion d’une révision courante partagent la même transaction
  SQLite. Une observation portant un `syncRunId` sans token d’ownership local est rejetée en
  fail-closed ; après une première perte de lease, toutes les mutations suivantes du même ancien
  owner restent donc rejetées. `SyncCatalogDocuments` traite `CATALOG_SYNC_RUN_OWNERSHIP_LOST`
  comme une erreur fatale du run et n’essaie pas de poursuivre avec les documents suivants.
- La récupération des sync-runs abandonnés sépare désormais décision et commit : les sondes OS de
  liveness/identité de processus sont exécutées hors transaction d’écriture SQLite, puis une courte
  transaction `BEGIN IMMEDIATE` applique uniquement les récupérations dont `started_at`,
  `heartbeat_at`, owner token, PID et hostname correspondent encore au snapshot observé. Un owner
  qui renouvelle son heartbeat pendant une sonde lente invalide donc la récupération candidate au
  lieu d’être écrasé, sans conserver un write-lock SQLite pendant PowerShell/`ps`.
- `FileLease.release()` est reprenable : une suppression réussie du lock principal suivie d’un échec
  transitoire du heartbeat ne marque pas prématurément le lease comme libéré.
- L’acquisition `FileLeaseLock.acquire()` est également exception-safe : si la création initiale du
  heartbeat échoue, le heartbeat éventuellement partiel est nettoyé tant que l’ownership est certain,
  puis le lock principal est supprimé. Si l’unlink direct est transitoirement bloqué, le lock est
  déplacé vers une quarantaine à nom généré par le serveur afin de libérer le chemin actif ; les
  erreurs secondaires de rollback restent attachées à l’erreur primaire pour diagnostic.
- Les nouveaux `FileLease` utilisent le format `1.2` avec un heartbeat propre à chaque génération.
  Son chemin est dérivé d’un SHA-256 du token d’owner, jamais du token brut. Un ancien owner ne peut
  donc plus supprimer ou écraser le heartbeat d’un owner de remplacement pendant `release`, `renew`
  ou cleanup stale. La lecture des anciens formats `1.0`/`1.1` et de leur heartbeat partagé reste
  conservée pour compatibilité de récupération.
- La récupération d’un `FileLease` stale libère d’abord le namespace actif par rename ownership-safe.
  La suppression de la quarantaine et de l’ancien heartbeat est ensuite retentée avec un budget
  borné ; un `EPERM`/`EBUSY` résiduel est journalisé sans rendre de nouveau le lock stale actif ni
  empêcher à lui seul une nouvelle acquisition.
- La configuration catalogue refuse deux `stable_key` identiques dans une même source avant toute
  ouverture ou migration de `catalog.db` sur les chemins `load-sources` et `sync`. Deux déclarations
  ne peuvent plus converger silencieusement vers le même `publicId` documentaire.
- Une reprise de synchronisation limitée est liée à la configuration effective qui a produit le
  curseur. Le rapport émet `resumeAfter` avec `resumeConfigurationFingerprint`; la reprise exige les
  deux valeurs et compare l’empreinte avant création du `sync_run`. Une modification ou un
  réordonnancement de la configuration échoue avec `CATALOG_RESUME_CONFIGURATION_CHANGED` au lieu de
  sauter silencieusement des documents.
- `list_search_history` est une lecture réellement non mutante : les lignes hors fenêtre de rétention
  sont exclues par le prédicat SQL de lecture sans `DELETE` ni chmod déclenché par le tool call. La
  purge physique reste effectuée sur les chemins d’écriture/rétention.
- Les annotations MCP reflètent les effets persistants réels : `search_web`, `fetch_url` et
  `search_docs` ne sont pas annoncés read-only/idempotents car ils peuvent écrire cache et/ou
  historique local ; `list_docs`, `read_doc_section` et `list_search_history` restent annoncés comme
  lectures read-only/idempotentes.
- Les tests de fault injection couvrent les doubles fautes d’acquisition, les changements d’owner,
  les suppressions `ENOENT`, le fencing répété d’un ancien owner, les échecs de cleanup après
  quarantaine stale, le renouvellement concurrent d’un sync-run pendant une sonde d’identité,
  les courses release/renew entre générations de `FileLease`, les reprises de catalogue après dérive
  de configuration et l’absence de mutation physique pendant la lecture de l’historique.

## Contrat MCP public

Le serveur STDIO expose exactement six outils :

- `search_web`
- `fetch_url`
- `search_docs`
- `list_docs`
- `read_doc_section`
- `list_search_history`

Les annotations de side effects sont intentionnellement différenciées :

- `search_web`, `fetch_url` et `search_docs` ont `readOnlyHint: false` et `idempotentHint: false`, car
  un appel peut modifier le cache local et/ou ajouter une occurrence à l’historique local ; ces
  effets restent non destructifs (`destructiveHint: false`) ;
- `list_docs`, `read_doc_section` et `list_search_history` ont `readOnlyHint: true` et
  `idempotentHint: true` ; leur exécution ne modifie pas l’état persistant applicatif.

Les quatre resources statiques sont :

- `mcp-search-net://catalog`
- `mcp-search-net://sources`
- `mcp-search-net://documents`
- `mcp-search-net://sections`

Les neuf resource templates sont :

- `mcp-search-net://sources/page/{offset}`
- `mcp-search-net://sources/{sourceId}`
- `mcp-search-net://documents/page/{offset}`
- `mcp-search-net://documents/{documentId}`
- `mcp-search-net://documents/{documentId}/versions`
- `mcp-search-net://documents/{documentId}/versions/page/{offset}`
- `mcp-search-net://documents/{documentId}/versions/{versionId}`
- `mcp-search-net://sections/page/{offset}`
- `mcp-search-net://sections/{sectionId}`

Le workflow documentaire recommandé est `search_docs` puis `read_doc_section` avec le `sectionId`
réel retourné. `search_web` et `fetch_url` servent au Web frais ou absent du catalogue.
`list_search_history` inspecte uniquement l’historique local déjà enregistré et ne relance aucune
recherche.

Toutes les sorties provenant du Web ou du catalogue sont considérées comme contenu externe non
fiable. Le serveur n’exécute jamais le contenu récupéré comme instruction.

## Stockage SQLite

Trois bases ont des responsabilités distinctes :

- `cache.sqlite` : cache Web ;
- `catalog.db` : catalogue documentaire ;
- `history.sqlite` : historique local des occurrences validées de `search_web` et `search_docs`.

Les chemins doivent être distincts, y compris après canonicalisation des liens/répertoires. Sous
POSIX, les fichiers SQLite et leurs WAL/SHM sont durcis en `0600` et les répertoires privés en
`0700`. Les connexions utilisent `busy_timeout`, WAL, `foreign_keys=ON` et une initialisation de
schéma sérialisée par transaction `BEGIN IMMEDIATE`.

Le catalogue vérifie au démarrage `PRAGMA integrity_check`, `PRAGMA foreign_key_check`, les pointeurs
et flags de version courante ainsi que la cohérence du FTS. Les mises à jour de source et la
reconstruction FTS associée sont transactionnelles.

L’historique est fail-open : une panne de `history.sqlite` n’annule pas une recherche principale
réussie. La rétention est bornée en durée et en nombre d’entrées. Les lectures appliquent la fenêtre
de rétention comme filtre sans muter la base ; la purge physique des entrées expirées intervient lors
des écritures. Les formes évidentes de secrets Bearer/JWT/PAT/API-key/password/secret/signature sont
remplacées par `[REDACTED]` avant persistance ; `history.enabled: false` permet de désactiver
entièrement cette journalisation locale.

## Migrations catalogue et historique

Les migrations catalogue appliquées dans l’ordre sont :

- `C001__create_catalog_sources.sql`
- `C002__create_documents.sql`
- `C003__create_document_versions.sql`
- `C004__create_document_sections.sql`
- `C005__create_sync_tracking.sql`
- `C006__create_document_section_fts.sql`
- `C007__harden_revision_integrity.sql`
- `C008__add_catalog_pagination_indexes.sql`
- `C009__allow_repeated_section_content.sql`
- `C010__add_sync_run_kind.sql`
- `C011__persist_pending_version_promotion.sql`
- `C012__make_language_indexes_nocase.sql`
- `C013__add_sync_run_lease.sql`
- `C014__guard_concurrent_sync_execution.sql`

La migration historique courante est :

- `H001__create_search_history.sql`

Une migration appliquée est immuable. Toute évolution de schéma crée une nouvelle migration avec un
nouveau numéro et checksum.

## Invariants catalogue

- Une révision courante est atomique : document, version, sections, FTS, pointeur courant et
  observation de synchronisation sont validés dans la même transaction.
- Toute observation de synchronisation doit être portée par un `syncRunId` encore détenu localement ;
  l’absence du token local ou l’échec du heartbeat durable fence la mutation avant commit.
- La décision de récupération d’un sync-run abandonné peut effectuer des sondes OS lentes, mais ces
  sondes ne tiennent jamais le writer SQLite. Le commit de récupération est un CAS durable sur le
  snapshot exact de lease observé afin qu’un renouvellement concurrent gagne toujours la course.
- Les sections sont chunkées et bornées avant persistance ; deux occurrences identiques à des
  positions différentes restent distinctes.
- `C011` persiste l’intention `pending_current` pour les primitives legacy afin qu’une version ne
  devienne courante qu’avec ses sections et son FTS.
- `C012` conserve les filtres de langue BCP-47 indexables avec `COLLATE NOCASE`.
- `C013` ajoute owner token, PID, hostname, process identity et heartbeat aux runs de
  synchronisation. La récupération d’un owner mort clôt le run et invalide son ancien token.
- `C014` réconcilie les overlaps historiques puis impose les gardes `INSERT`/`UPDATE` entre toutes
  les connexions/processus.

## Sécurité réseau et contenu

La politique de fetch public bloque localhost, réseaux privés, link-local, multicast et plages
réservées. Chaque destination initiale et chaque redirect sont revalidés ; la connexion est épinglée
sur une IP approuvée après résolution DNS afin de fermer les scénarios de DNS rebinding.

`SecureHttpGateway` applique :

- deadline absolue ;
- budget d’octets partagé sur toute la chaîne ;
- limite de redirects ;
- limite de concurrence ;
- temporisation par origine avec nombre d’origines mémorisées borné ;
- contrôle robots.txt lorsque configuré.

Le fallback Crawl4AI reçoit du contenu neutralisé et non une URL publique libre à recrawler. Les
liens extraits sont revalidés et bornés avant exposition. L’extraction PDF borne taille, pages,
caractères et durée. Les sanitizers neutralisent scripts, iframes, formulaires, handlers actifs et
schémas de lien dangereux.

## Supply chain et release Windows

- Runtime supporté : Node.js `24.18.0`.
- `@modelcontextprotocol/sdk@1.30.0` et `better-sqlite3@13.0.3` sont fixés.
- `.npmrc` impose `strict-allow-scripts=true` avec allowlist explicite des scripts d’installation.
- Les images Docker critiques sont fixées par digest.
- Les GitHub Actions utilisées dans les workflows sont fixées par SHA.
- La CI exécute audit npm complet et audit production ; un workflow quotidien refait les audits.
- Inno Setup `6.7.3` est téléchargé depuis une URL fixe et vérifié par SHA-256 avant exécution.
- Le runtime Node Windows embarqué est également vérifié par SHA-256.
- Le job de qualification de release n’a que des permissions de lecture. Le job de publication
  séparé reçoit `contents: write`, ne checkout pas le repository, télécharge les artefacts qualifiés
  du même run et revérifie leurs SHA-256 avant création d’une release immutable.

## Variables d’environnement supportées

- `MCP_CONFIG_PATH`
- `MCP_PROFILE`
- `MCP_LOG_LEVEL`
- `MCP_CACHE_PATH`
- `MCP_CATALOG_PATH`
- `MCP_HISTORY_PATH`
- `MCP_OFFICIAL_SOURCES_PATH`
- `MCP_SEARXNG_URL`
- `MCP_CRAWL4AI_URL`
- `MCP_CRAWL4AI_TOKEN`
- `MCP_ALLOWED_PUBLIC_PORTS`

Les aliases historiques documentés dans les configurations utilisateur restent gérés lorsqu’ils
sont explicitement prévus par le loader, mais les noms ci-dessus constituent le contrat courant.

## Certification native

La dernière matrice native 3/3 historiquement finalisée couvre Claude Code, Claude Desktop et Codex
sur Windows 10 avec le runtime serveur
`a70b9a51527543c9417566326bb780121954cef5`. Elle vérifie la chaîne réelle :

`search_docs -> sectionId réel -> read_doc_section(exactement le même sectionId)`.

Cette preuve reste valide uniquement pour son SHA/version client/OS. Elle **ne qualifie pas** un
nouveau SHA serveur. L’issue #73 reste ouverte jusqu’à une nouvelle observation native Claude Code +
Claude Desktop + Codex contre la baseline finale choisie pour la clôture. Le harness automatisé et
la sonde STDIO ne peuvent jamais transformer seuls cette étape en PASS natif.

## Ancrages historiques conservés

Les éléments suivants restent volontairement présents pour maintenir la traçabilité et les gates de
réconciliation documentaire :

- Intégration V2 : PR #8 mergée dans `master` le 5 août 2026.
- Hardening post-audit complet : PR #37 mergée dans `master` le 6 août 2026.
- Qualification de la PR #37 : run `31126841127`.
- Décision embeddings : `prototype-local-vector-index`.
- `adoptEmbeddingRuntimeNow: false`.

Ces ancrages sont historiques ; ils ne remplacent pas les checks attachés au SHA exact d’un nouveau
candidat.
