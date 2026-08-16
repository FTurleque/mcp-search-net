# État courant de `mcp-search-net`

Ce document décrit l’état fonctionnel et architectural autoritatif du produit courant. Les SHA et
exécutions CI cités ici sont des **preuves datées de qualification** et non une identité dynamique du
HEAD Git : le HEAD réel reste déterminé par le dépôt. Les documents datés sous `docs/planning/`
restent des preuves historiques.

## Version, branches et qualification

- Version SemVer : `1.1.3`.
- Branche de release et source de vérité publiée : `master`.
- Branche d’intégration courante : `develop`.
- Intégration V2 : PR #8 mergée.
- Baseline `develop` intégrée avant le candidat post-audit courant : merge de la PR #103,
  `17ac4224f159f2f43d3c29f5390d66a403b2bd8f`, tree
  `118c1366b12f5dee24d23cdd82ba4406d8398db3`.
- La CI post-merge #1337 / `31963224930` a terminé en succès sur ce SHA pour la validation Node.js,
  Docker/live E2E et le packaging/lifecycle Windows. Le job Sonar est ignoré sur les pushes
  `develop` par conception ; le head exact de la PR #103 avait passé le Quality Gate Sonar.
- Le nouvel audit complet de cette baseline n’a identifié aucun P0, P1 ou P2 résiduel. Cinq P3 de
  résilience/exploitation sont corrigés sur le candidat `agent/fix-post-audit-p3-20260816` ; ces
  corrections ne sont pas déclarées intégrées à `develop` avant merge explicite de leur PR.
- L’issue #73 reste le tracker de clôture pour les preuves de certification native Claude Code,
  Claude Desktop et Codex contre le SHA serveur finalement intégré.

## Hardening du candidat post-audit

Le candidat ferme cinq écarts résiduels sans modifier les dépendances, migrations, seuils qualité,
workflows CI ou règles de gouvernance :

1. le pool PDF reste strictement borné à deux slots et devient auto-réparant ; une création de worker
   de remplacement qui échoue transitoirement laisse le slot réessayable avec backoff au lieu de
   réduire définitivement la capacité du processus ;
2. le backup catalogue formalise le hard-link final comme point de commit. Le snapshot temporaire
   est déjà privé, vérifié et fermé avant publication ; les nettoyages post-commit de la famille
   SQLite temporaire sont best-effort et ne peuvent plus transformer une publication réussie en
   faux échec métier ;
3. les répertoires persistants SQLite préexistants sont rechmodés en `0700` sur POSIX, pas seulement
   créés avec un mode souhaité ; les fichiers SQLite et sidecars restent durcis en `0600` ;
4. lorsque `verifyIntegrityOnOpen` est demandé, le catalogue est vérifié avant récupération des
   sync-runs abandonnés afin qu’aucune mutation de récupération ne précède le verdict d’intégrité ;
5. les commandes CLI métier ouvrent le catalogue avec l’integrity gate actif. `verify`, `health` et
   `rebuild-index` conservent un chemin administratif explicite capable de diagnostiquer/réparer une
   incohérence FTS ; `purge-versions` vérifie également l’intégrité avant toute suppression.

## Contrat MCP public

Le serveur STDIO expose exactement six outils :

- `search_web`
- `fetch_url`
- `search_docs`
- `list_docs`
- `read_doc_section`
- `list_search_history`

`search_web`, `fetch_url` et `search_docs` ne sont pas annoncés read-only/idempotents, car ils peuvent
écrire cache et/ou historique local. `list_docs`, `read_doc_section` et `list_search_history` sont des
lectures read-only/idempotentes.

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

Le workflow documentaire portable recommandé est `search_docs` puis `read_doc_section` avec le
`sectionId` réellement retourné. Tout contenu Web ou documentaire est traité comme contenu externe
non fiable et n’est jamais exécuté comme instruction.

## Stockage SQLite

Trois bases ont des responsabilités distinctes :

- `cache.sqlite` : cache Web ;
- `catalog.db` : catalogue documentaire ;
- `history.sqlite` : historique local des occurrences validées de recherche.

Les chemins doivent rester distincts, y compris après canonicalisation. Sous POSIX, les répertoires
privés sont maintenus en `0700` et les fichiers SQLite/WAL/SHM en `0600`. Les connexions utilisent un
`busy_timeout`, WAL et `foreign_keys=ON` ; les migrations sont sérialisées.

Le catalogue vérifie `PRAGMA integrity_check`, `PRAGMA foreign_key_check`, les pointeurs/flags de
version courante et la cohérence FTS sur les chemins fail-closed. Promotion de version, sections,
FTS, pointeur courant et observation de synchronisation partagent une transaction SQLite.

L’historique reste fail-open pour le résultat métier principal. La rétention est bornée, les lectures
n’effectuent pas de purge physique et les formes évidentes de secrets sont expurgées avant
persistance.

## Migrations catalogue et historique

Les migrations catalogue immuables appliquées dans l’ordre sont :

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

Toute évolution de schéma crée une nouvelle migration numérotée et checksumée ; une migration déjà
appliquée n’est jamais réécrite.

## Concurrence et récupération

- Les synchronisations `EXECUTION` incompatibles sont exclues durablement par SQLite : une exécution
  globale exclut toute autre exécution ; deux exécutions ciblées de même source s’excluent ; deux
  sources distinctes et les runs `PLAN` peuvent coexister.
- Les mutations portées par un `syncRunId` sont fenced par ownership durable. Une perte de lease est
  fatale pour le run et l’ancien owner ne peut plus publier d’observation/révision.
- La récupération des sync-runs sépare les sondes OS potentiellement lentes de la transaction
  d’écriture ; le commit de récupération compare le snapshot exact observé.
- Les `FileLease` publient leur heartbeat par staging + rename atomique, utilisent un heartbeat
  owner-scoped et échouent fermé si un PID local est vivant mais que son identité ne peut être
  établie. Seul un PID mort ou une réutilisation confirmée permet une récupération stale.
- Les opérations de maintenance utilisent une lease dédiée et ne doivent jamais permettre à un
  second owner de voler l’exclusion pendant une opération SQLite synchrone longue.

## Synchronisation catalogue

Les `sourceKey`, langues et métadonnées documentaires sont normalisés avant effets persistants. Les
collisions après canonicalisation échouent avant ouverture du catalogue ou fetch réseau. Une reprise
limitée est liée à une empreinte incluant l’ordre des documents et l’état persistant `enabled` des
sources référencées ; toute dérive invalide le curseur avant création du sync-run.

Les téléchargements sont bornés en taille, redirects et temps. L’extraction PDF est isolée dans des
workers Node bornés en mémoire avec limites de pages, caractères et items texte. Le pool ne crée pas
de workers de débordement : les demandes excédentaires attendent un slot dans leur deadline.

## Réseau et sécurité

- seuls HTTP/HTTPS sont acceptés ;
- localhost, metadata cloud, réseaux privés/réservés, credentials d’URL et DNS mixtes sont bloqués ;
- les redirections sont résolues et revalidées ;
- la connexion réseau est épinglée sur une adresse DNS approuvée ;
- les budgets de bytes/deadline couvrent les redirects et contrôles associés ;
- Crawl4AI reçoit du contenu déjà récupéré et neutralisé via `raw://`, jamais une URL publique à
  télécharger directement ;
- le serveur MCP n’expose aucun port applicatif et écrit uniquement JSON-RPC sur stdout ;
- le conteneur MCP est non-root, filesystem read-only, capabilities supprimées et sans socket Docker ;
- les images fournisseurs sont figées par digest ;
- les erreurs publiques ne reflètent pas les métadonnées distantes non fiables.

## Variables d’environnement principales

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

La validation de configuration est stricte. En profil production, le HTTP public est interdit et les
jetons de développement connus sont refusés.

## Qualification et release

Une release n’est considérée qualifiée que si les checks sont attachés au SHA exact du candidat. La
politique SemVer impose l’égalité entre la version demandée, `package.json`, `package-lock.json` et la
version embarquée. Le packaging Windows vérifie le runtime Node et l’installateur Inno Setup avant
exécution, préserve les intégrations MCP préexistantes non gérées et couvre clean install, upgrade,
rollback et uninstall.

Les tests ne doivent pas être affaiblis pour faire passer la CI. Les seuils de couverture, contrôles
supply-chain, audits npm, suites security/resilience/integration et exact-head gates font partie de la
qualification normale.
