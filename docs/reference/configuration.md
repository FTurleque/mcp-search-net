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

- `MCP_SEARCH_CONFIG` remplace le chemin du fichier applicatif ;
- `CRAWL4AI_API_TOKEN` remplace le jeton configuré.

Le lanceur définit automatiquement le fichier utilisateur et le jeton local par défaut lorsqu’ils sont absents.

## Paramètres applicatifs

- `searxng` et `crawl4ai` : URL et délai ;
- `cache` : chemin SQLite, TTL et nombre maximal d’entrées ;
- `limits` : budgets des résultats, extraits, Markdown et liens ;
- `security.allowedPorts` : ports Web publics acceptés ;
- `security.allowHttp` : autorisation de HTTP ;
- `security.maxDownloadBytes` : limite absolue, au maximum 10 Mio ;
- `security.maxRedirects` : limite de redirections, au maximum 5 ;
- `security.maxConcurrency` et `minimumDelayMs` : pression maximale sur les sites cibles ;
- `security.respectRobotsTxt` : contrôle de `robots.txt` avant téléchargement ;
- `officialSourcesPath` : registre YAML relatif à la configuration ;
- `logging.level` : niveau de log structuré sur `stderr`.

La configuration est validée par Zod au démarrage. Une clé obligatoire invalide arrête le processus avec un message structuré ; aucune valeur silencieuse n’est inventée.

## Registre officiel

Chaque source définit un identifiant, un domaine, une URL de base, la gestion des sous-domaines, des mots-clés et une priorité. Utiliser `pathPrefix` lorsqu’un domaine partagé comme `github.com` ne doit être officiel que pour un dépôt précis.

`githubOrganizations` permet aussi de reconnaître une ou plusieurs organisations GitHub contrôlées. La comparaison porte uniquement sur le domaine exact `github.com` et sur le premier segment complet du chemin ; une organisation au nom ressemblant ou un faux sous-domaine ne correspond pas.

Le registre V1 contient notamment MCP, GitHub, Node.js, TypeScript, SearXNG, Crawl4AI, Docker, SQLite, JetBrains, OpenJDK, Maven, Quarkus, OpenJFX, Oracle et Sonar.

## Secrets locaux

Le jeton fourni est destiné au développement local et les ports sont liés à `127.0.0.1`. Pour un poste partagé ou une exposition réseau volontaire, définir un jeton fort dans un fichier `.env` à côté du `compose.yaml` installé et fournir la même valeur au processus MCP.
