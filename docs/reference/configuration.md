# Configuration

## Fichiers

Dans le dépôt :

- `config/application.yml` : développement depuis le dépôt ;
- `config/application.user.yml` : modèle de l’installation Windows ;
- `config/application.docker.yml` : exécution du serveur dans Docker ;
- `config/official-sources.yml` : domaines officiels et priorités ;
- `config/searxng/settings.yml` : instance SearXNG, avec JSON explicitement autorisé.

Dans l’installation, modifier `%LOCALAPPDATA%\mcp-search-net\config`. L’installateur préserve ces fichiers et écrit les modèles récents sous `*.default`.

Les trois profils applicatifs du candidat portent la version `1.1.5`. Cette valeur alimente les
informations serveur MCP.

## Variables d’environnement

- `MCP_CONFIG_PATH` remplace le chemin du fichier applicatif ;
- `MCP_PROFILE` remplace le profil `development`, `test` ou `production` ;
- `MCP_OFFICIAL_SOURCES_PATH` remplace le registre officiel ;
- `MCP_CRAWL4AI_TOKEN` fournit le jeton de la façade ;
- `MCP_SEARXNG_URL` et `MCP_CRAWL4AI_URL` remplacent les endpoints ;
- `MCP_CACHE_PATH` contrôle le chemin du cache Web ;
- `MCP_CATALOG_PATH` contrôle réellement le chemin du catalogue serveur et des CLI ;
- `MCP_HISTORY_PATH` contrôle le chemin de l’historique local des recherches lorsqu'il est activé ;
- `MCP_LOG_LEVEL` remplace le niveau de journalisation ;
- `MCP_ALLOWED_PUBLIC_PORTS` remplace la liste des ports publics, au format `80,443`.

Le serveur résout les chemins relatifs de cache et d’historique depuis le dossier du fichier
applicatif. Sans `MCP_CATALOG_PATH`, il place `catalog.db` à côté du chemin de cache résolu. Les trois
bases `cache.sqlite`, `catalog.db` et `history.sqlite` doivent cibler des fichiers distincts ; le
serveur vérifie aussi les chemins canoniques et les alias de fichiers existants avant de démarrer.

Les CLI catalogue résolvent leur `--path` ou `MCP_CATALOG_PATH` depuis le répertoire courant ;
utiliser un chemin absolu garantit donc une cible identique sur toutes les surfaces.

Les alias historiques réellement acceptés sont `MCP_SEARCH_CONFIG`,
`MCP_SEARCH_OFFICIAL_SOURCES_PATH`, `MCP_SEARCH_SEARXNG_URL`, `MCP_SEARCH_CRAWL4AI_URL`,
`MCP_SEARCH_CACHE_PATH`, `MCP_SEARCH_LOG_LEVEL`, `MCP_SEARCH_CACHE_ENABLED` et
`MCP_SEARCH_CACHE_CONTINUE_ON_ERROR`. Ils restent des compatibilités transitoires ; il n’existe pas
d’alias historique pour le catalogue, l’historique, le profil, le token ou les ports publics. Les
nouveaux déploiements utilisent les noms principaux ci-dessus. `.env.example` ne contient que des
valeurs d’exemple destinées au profil `development`.

La priorité est : valeurs internes sûres, YAML, variables d’environnement, puis paramètres d’outil
bornés. Toutes les surcharges repassent par Zod ; elles ne peuvent pas augmenter les maxima absolus.

## Paramètres applicatifs

- `searxng` et `crawl4ai` : URL et délai ;
- `cache.enabled` : active ou désactive SQLite pour le cache Web ;
- `cache.continueOnError` : poursuit avec `cacheStatus: DISABLED` si SQLite devient indisponible ;
- `cache` : chemin SQLite, rétention stale, TTL (recherche 60 min, documentation 24 h,
  README 6 h, sitemap 24 h), nombre global maximal d’entrées (`maxEntries: 2000`) et volume
  global maximal des payloads JSON sérialisés (`maxBytes: 268435456`, soit 256 Mio) ;
- `history.enabled` : active ou désactive l’historique persistant des appels `search_web` et
  `search_docs` ; la valeur par défaut du schéma est `false`, y compris pour une configuration qui
  omet entièrement la section `history:` ; les profils de production Windows et Docker le
  fixent explicitement à `false`, et le profil de développement l'active explicitement pour les
  tests de contrat ; une mise à jour Windows migre une ancienne valeur `true` héritée du défaut
  précédent vers `false` sans toucher un opt-in explicite détectable ;
- `history.exposeTool` : expose ou masque `list_search_history` dans l'inventaire MCP ; la valeur par
  défaut du schéma est `false`, y compris pour une ancienne configuration qui ne possède pas encore
  ce champ ; le profil de développement l'active explicitement pour les tests de contrat ;
- `history.path` : chemin de `history.sqlite` ;
- `history.retentionDays` : rétention maximale, 90 jours par défaut, bornée entre 1 et 3 650 jours ;
- `history.maxEntries` : nombre maximal d’occurrences conservées, 20 000 par défaut, borné entre
  100 et 1 000 000 ;
- `limits` : budgets des résultats, extraits, Markdown et liens ;
- `security.allowedPorts` : ports Web publics acceptés ;
- `security.allowHttp` : autorisation de HTTP ;
- `security.maxDownloadBytes` : limite absolue, au maximum 10 Mio ;
- `security.maxRedirects` : limite de redirections, au maximum 5 ;
- `security.maxConcurrency` et `minimumDelayMs` : pression maximale sur les sites cibles ;
- `security.respectRobotsTxt` : contrôle de `robots.txt` avant téléchargement ;
- `officialSourcesPath` : registre YAML relatif à la configuration ;
- `logging.level` : niveau de log structuré sur `stderr`.

L’historique est volontairement distinct du cache. Une expiration ou une éviction de
`search_cache` ne supprime donc pas l’occurrence correspondante de `history.sqlite`. Chaque appel
validé constitue une nouvelle ligne, y compris lorsqu’une requête identique est répétée ou servie
par le cache. L’écriture d’historique est fail-open : une panne de `history.sqlite` est journalisée
sur `stderr` mais ne transforme jamais une recherche réussie en erreur.

`history.enabled` et `history.exposeTool` sont indépendants. Pour le mode d'inspection local complet,
les deux doivent être `true`. Pour conserver un historique sans l'exposer aux modèles MCP, utiliser
`history.enabled: true` et `history.exposeTool: false`. Pour la confidentialité maximale, conserver
les deux à `false`.

La configuration est validée par Zod au démarrage. Les maxima absolus sont 10 résultats,
10 sections, 30 000 caractères, 50 liens, 10 Mio par téléchargement, 2 Gio de payloads cache,
5 redirections et 20 secondes. Une valeur invalide arrête le processus avec un message structuré.

## Données enregistrées dans l’historique

Lorsque `history.enabled: true`, `history.sqlite` conserve uniquement des métadonnées nécessaires à
l’inspection locale :

- `requestId` et outil (`search_web` ou `search_docs`) ;
- requête validée et paramètres de recherche techniques ;
- instant d’exécution, durée, statut et provider ;
- statut de cache lorsqu’il existe, nombre de résultats et codes d’avertissement ;
- code d’erreur public pour une recherche validée qui échoue.

Avant l’écriture SQLite, le serveur applique une redaction best-effort des formes évidentes de
credentials dans la requête et les paramètres : Bearer, JWT, PAT connus, API key, password, secret
et signature sont remplacés par `[REDACTED]`, et les clés de paramètres manifestement sensibles sont
neutralisées. Cette protection ne peut toutefois pas garantir qu’un texte libre ne contienne jamais
une donnée sensible sous une forme non reconnue. `history.sqlite` doit donc rester protégé comme une
donnée locale utilisateur ; les profils de production le désactivent désormais par défaut.

Le serveur n’y duplique pas le contenu complet des pages ou des sections, ni les headers
d’autorisation ni les variables d’environnement. La base reste locale et n’est pas exposée comme
fichier arbitraire via MCP ; sa consultation passe exclusivement par `list_search_history`, lui-même
absent de l'inventaire MCP tant que `history.exposeTool` n'est pas explicitement activé.

## Registre officiel

Chaque source définit un identifiant, un domaine, une URL de base HTTPS, la gestion des
sous-domaines, des mots-clés et une priorité. Une URL résultat HTTP n’est jamais
`VERIFIED_OFFICIAL`, même lorsque son hostname, son chemin ou son organisation GitHub correspond au
registre. Utiliser `pathPrefix` lorsqu’un domaine partagé comme `github.com` ne doit être officiel
que pour un dépôt précis.

Le mode `sourcePolicy: strict` utilise ce registre **avant** la recherche : les sources dont les
mots-clés correspondent à la requête sont prioritaires, puis les domaines officiels éligibles sont
transmis à SearXNG sous forme de contraintes `site:`. Le filtrage `VERIFIED_OFFICIAL` reste ensuite
appliqué aux résultats afin qu'une contrainte de recherche ne suffise jamais à conférer le statut
officiel.

Une URL dont le hostname ou le chemin ressemble à une documentation mais qui n'appartient pas au
registre reçoit `UNVERIFIED_DOCUMENTATION`, jamais un statut d'officialité. Ce signal ne vaut que
comme faible indice de pertinence documentaire.

`githubOrganizations` permet aussi de reconnaître une ou plusieurs organisations GitHub contrôlées. La comparaison porte uniquement sur le domaine exact `github.com` et sur le premier segment complet du chemin ; une organisation au nom ressemblant ou un faux sous-domaine ne correspond pas.

Le registre V1 contient notamment MCP, GitHub, Node.js, TypeScript, SearXNG, Crawl4AI, Docker, SQLite, JetBrains, OpenJDK, Maven, Quarkus, OpenJFX, Oracle et Sonar.

## Secrets locaux

Compose n’a plus de secret par défaut : `SEARXNG_SECRET` et
`CRAWL4AI_API_TOKEN` doivent exister dans un fichier `.env` local ou dans
l’environnement. Le jeton fourni au processus MCP doit avoir la même valeur que
`CRAWL4AI_API_TOKEN`.

Les fichiers du dépôt déclarent explicitement leur profil : développement pour
`application.yml`, production pour `application.user.yml` et
`application.docker.yml`. Les profils production fixent `security.allowHttp: false`,
`history.enabled: false` et `history.exposeTool: false`; une configuration production qui réactive
HTTP public est rejetée. Les endpoints providers internes (`searxng.baseUrl`, `crawl4ai.baseUrl`)
peuvent rester en HTTP en profil production uniquement lorsque leur hôte est local/interne connu
(`localhost`, `127.0.0.1`, `::1`, une plage privée RFC 1918/link-local/CGNAT, ou les noms de
service Docker Compose `searxng`/`crawl4ai`) ; un hôte distant en HTTP est rejeté au chargement de
la configuration, et le démarrage échoue immédiatement si un jeton Crawl4AI est configuré alors que
`crawl4ai.baseUrl` pointe vers un hôte distant en HTTP, afin de ne jamais envoyer ce jeton en clair.
Cette politique est distincte de celle des URLs publiques fournies par l'appelant (SSRF) : elle a le
sens inverse (autoriser le local, refuser le distant en clair) et ne la remplace pas. Un jeton
d’exemple connu dans un profil non développement provoque un arrêt avant appel fournisseur.
L’installateur Windows génère
un `.env` aléatoire s’il n’existe pas, le préserve lors des mises à jour et le charge dans les
wrappers Node et Compose.
