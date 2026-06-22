# mcp-search-net

Serveur MCP Web local, en lecture seule, destiné à GitHub Copilot dans IntelliJ
IDEA. La V1 expose exactement deux outils :

- `search_web` découvre des pages avec SearXNG et privilégie les domaines du
  registre officiel ;
- `fetch_url` récupère une URL publique connue, applique la protection SSRF,
  extrait du Markdown et limite les sections retournées.

Le serveur utilise un cache SQLite local, n’embarque aucun LLM et ne requiert
aucune API commerciale. La V2 documentaire (catalogue, synchronisation, FTS,
embeddings et recherche multi-document) n’est pas implémentée.

## Architecture

Le dépôt suit une architecture hexagonale simplifiée :

```text
src/domain          modèles, objets de valeur et règles déterministes
src/application     ports et cas d’usage
src/infrastructure  SearXNG, Crawl4AI, SQLite, configuration, DNS et logs
src/presentation    serveur, schémas et mapping MCP
src/bootstrap       assemblage et cycle de vie STDIO
```

Le domaine ne dépend ni du SDK MCP, ni de Zod, YAML, SQLite, SearXNG ou
Crawl4AI. SQLite reste uniquement un cache V1.

## Prérequis

- Node.js 24 LTS et npm ;
- Docker Desktop avec Docker Compose ;
- IntelliJ IDEA et GitHub Copilot pour l’intégration utilisateur.

## Installation

```bash
npm install
cp .env.example .env
```

Sous Windows, copiez manuellement `.env.example` vers `.env`. Remplacez les
jetons d’exemple par des valeurs aléatoires locales avant d’utiliser un poste
partagé.

## Développement

```bash
docker compose up -d searxng crawl4ai
npm run dev
```

SearXNG et Crawl4AI sont publiés uniquement sur `127.0.0.1`, respectivement sur
les ports 8888 et 11235. Le serveur MCP écrit exclusivement le protocole JSON-RPC
sur `stdout` et ses diagnostics JSON sur `stderr`.

## Build et exécution locale

```bash
npm run build
npm start
```

Le processus utilise le transport MCP STDIO ; il n’ouvre aucun port applicatif.

## Validation

```bash
npm run format:check
npm run lint
npm run build
npm run test:unit
npm run test:integration
npm test
```

La suite d’intégration est déterministe et n’exige ni Internet ni Docker. Avec
les fournisseurs démarrés :

```bash
npm run test:e2e
```

Les rapports JSON sont écrits dans `.data/test-reports`. Les lanceurs de release
échouent si un test requis est ignoré.

## Docker

Construire les images et démarrer les fournisseurs :

```bash
docker compose config
docker compose build
docker compose up -d searxng crawl4ai
docker compose ps
```

Exécuter le serveur MCP conteneurisé en STDIO :

```bash
docker compose run --rm -T mcp-search-net
```

Arrêter la stack :

```bash
docker compose down
```

Le conteneur MCP s’exécute sans root, avec filesystem en lecture seule,
capabilities supprimées et volume d’écriture limité au cache. Aucun socket Docker,
mode privilégié ou réseau hôte n’est utilisé.

## IntelliJ IDEA / GitHub Copilot

Le chemin exact de la configuration MCP dépend de la version d’IntelliJ et du
plugin GitHub Copilot. Dans l’écran de configuration MCP disponible dans votre
version, renseignez les champs génériques `command`, `args`, `env` et `cwd`.

Exécution Node locale, après `npm run build` :

```json
{
  "command": "node",
  "args": ["N:/chemin/vers/mcp-search-net/dist/bootstrap/main.js"],
  "cwd": "N:/chemin/vers/mcp-search-net",
  "env": {
    "MCP_CONFIG_PATH": "N:/chemin/vers/mcp-search-net/config/application.yml",
    "MCP_CRAWL4AI_TOKEN": "votre-jeton-local"
  }
}
```

Exécution Docker :

```json
{
  "command": "docker",
  "args": ["compose", "run", "--rm", "-T", "mcp-search-net"],
  "cwd": "N:/chemin/vers/mcp-search-net",
  "env": {
    "CRAWL4AI_API_TOKEN": "votre-jeton-local"
  }
}
```

Redémarrez la fenêtre IntelliJ après une modification et vérifiez que Copilot
affiche uniquement `search_web` et `fetch_url`. Voir le
[guide IntelliJ détaillé](docs/getting-started/intellij-copilot.md).

## Configuration

Les variables principales sont :

```text
MCP_CONFIG_PATH
MCP_LOG_LEVEL
MCP_CACHE_PATH
MCP_OFFICIAL_SOURCES_PATH
MCP_SEARXNG_URL
MCP_CRAWL4AI_URL
MCP_CRAWL4AI_TOKEN
MCP_ALLOWED_PUBLIC_PORTS
```

La priorité est : valeurs internes sûres, YAML, environnement, puis paramètres
d’outil dans les maxima absolus. Une configuration obligatoire invalide arrête le
démarrage avec un diagnostic sur `stderr`.

## Sécurité

- seuls HTTP et HTTPS sont acceptés ;
- localhost, metadata cloud, réseaux privés/réservés, DNS mixte et redirections
  dangereuses sont bloqués avant connexion ;
- chaque redirection est résolue et validée à nouveau ;
- téléchargement limité à 10 Mo, cinq redirections et vingt secondes ;
- aucun JavaScript, hook, cookie, proxy, fichier ou identifiant fourni par
  l’appelant n’est accepté ;
- Crawl4AI reçoit le HTML contrôlé via `raw://`, jamais l’URL publique ;
- le contenu Web reste une donnée non fiable et n’est jamais exécuté ;
- secrets, chemins internes et stacks ne sont pas renvoyés.

## Diagnostic rapide

| Symptôme                   | Vérification                                                               |
| -------------------------- | -------------------------------------------------------------------------- |
| `stdout` corrompu          | rechercher un `console.log` ; seuls les logs JSON sur `stderr` sont permis |
| SearXNG répond 403         | vérifier que `json` est activé dans `config/searxng/settings.yml`          |
| Crawl4AI répond 401/403    | aligner `MCP_CRAWL4AI_TOKEN` et `CRAWL4AI_API_TOKEN`                       |
| healthcheck en échec       | `docker compose ps` puis `docker compose logs <service>`                   |
| erreur better-sqlite3      | vérifier Node 24, l’installation npm et les droits sur `.data`             |
| timeout                    | vérifier DNS, accès Internet et limites de configuration                   |
| URL bloquée                | confirmer qu’elle ne résout vers aucune adresse privée ou réservée         |
| Crawl4AI manque de mémoire | augmenter la mémoire Docker Desktop ; `shm_size` vaut 1 Go                 |

La documentation complète est indexée dans [docs/README.md](docs/README.md), avec
les contrats, l’installation Windows, la sécurité, les tests et le dépannage.

## Limites V1

Pas d’OCR, embeddings, base vectorielle, indexation persistante, catalogue,
synchronisation, crawl de domaine, suivi autonome des liens, authentification Web,
formulaires, CAPTCHA, captures d’écran, scripts utilisateur ou LLM interne. Un PDF
sans couche textuelle retourne `OCR_REQUIRED_NOT_SUPPORTED`.
