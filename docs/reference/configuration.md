# Configuration

## Fichiers

Dans le dépôt :

- `config/application.yml` : développement depuis le dépôt ;
- `config/application.user.yml` : modèle de l’installation Windows ;
- `config/application.docker.yml` : exécution du serveur dans Docker ;
- `config/official-sources.yml` : domaines officiels et priorités ;
- `config/searxng/settings.yml` : instance SearXNG, avec JSON explicitement autorisé.

Dans l’installation, modifier `%LOCALAPPDATA%\mcp-search-net\config`. L’installateur préserve ces fichiers et écrit les modèles récents sous `*.default`.

## Variables d’environnement

- `MCP_CONFIG_PATH` remplace le chemin du fichier applicatif ;
- `MCP_OFFICIAL_SOURCES_PATH` remplace le registre officiel ;
- `MCP_CRAWL4AI_TOKEN` fournit le jeton de la façade ;
- `MCP_SEARXNG_URL` et `MCP_CRAWL4AI_URL` remplacent les endpoints ;
- `MCP_CACHE_PATH` contrôle le chemin du cache ;
- `MCP_LOG_LEVEL` remplace le niveau de journalisation.

Les anciens noms préfixés `MCP_SEARCH_` restent acceptés pour compatibilité. Les
nouveaux déploiements utilisent les noms ci-dessus. `.env.example` ne contient
que des valeurs d’exemple.

La priorité est : valeurs internes sûres, YAML, variables d'environnement, puis paramètres d'outil bornés. Toutes les surcharges repassent par Zod ; elles ne peuvent pas augmenter les maxima absolus.

## Paramètres applicatifs

- `searxng` et `crawl4ai` : URL et délai ;
- `cache.enabled` : active ou désactive SQLite ;
- `cache.continueOnError` : poursuit avec `cacheStatus: DISABLED` si SQLite devient indisponible ;
- `cache` : chemin SQLite, rétention stale, nombre maximal d’entrées et TTL (recherche 60 min, documentation 24 h, README 6 h, sitemap 24 h, erreur temporaire 5 min) ;
- `limits` : budgets des résultats, extraits, Markdown et liens ;
- `security.allowedPorts` : ports Web publics acceptés ;
- `security.allowHttp` : autorisation de HTTP ;
- `security.maxDownloadBytes` : limite absolue, au maximum 10 Mio ;
- `security.maxRedirects` : limite de redirections, au maximum 5 ;
- `security.maxConcurrency` et `minimumDelayMs` : pression maximale sur les sites cibles ;
- `security.respectRobotsTxt` : contrôle de `robots.txt` avant téléchargement ;
- `officialSourcesPath` : registre YAML relatif à la configuration ;
- `logging.level` : niveau de log structuré sur `stderr`.

La configuration est validée par Zod au démarrage. Les maxima absolus sont 10 résultats, 10 sections, 30 000 caractères, 50 liens, 10 Mio, 5 redirections et 20 secondes. Une valeur invalide arrête le processus avec un message structuré.

## Registre officiel

Chaque source définit un identifiant, un domaine, une URL de base, la gestion des sous-domaines, des mots-clés et une priorité. Utiliser `pathPrefix` lorsqu’un domaine partagé comme `github.com` ne doit être officiel que pour un dépôt précis.

`githubOrganizations` permet aussi de reconnaître une ou plusieurs organisations GitHub contrôlées. La comparaison porte uniquement sur le domaine exact `github.com` et sur le premier segment complet du chemin ; une organisation au nom ressemblant ou un faux sous-domaine ne correspond pas.

Le registre V1 contient notamment MCP, GitHub, Node.js, TypeScript, SearXNG, Crawl4AI, Docker, SQLite, JetBrains, OpenJDK, Maven, Quarkus, OpenJFX, Oracle et Sonar.

## Secrets locaux

Le jeton fourni est destiné au développement local et les ports sont liés à `127.0.0.1`. Pour un poste partagé ou une exposition réseau volontaire, définir un jeton fort dans un fichier `.env` à côté du `compose.yaml` installé et fournir la même valeur au processus MCP.
