# mcp-search-net

Serveur MCP Web local, en lecture seule, destiné à GitHub Copilot dans IntelliJ
IDEA. La V1 expose deux outils stables :

- `search_web` découvre des pages avec SearXNG et privilégie les domaines du
  registre officiel ;
- `fetch_url` récupère une URL publique connue, applique la protection SSRF,
  extrait du Markdown et limite les sections retournées.

La V2 documentaire est en cours de construction dans la PR #8. Elle ajoute un
catalogue local séparé dans `catalog.db`, l'ingestion texte/Markdown, la
synchronisation contrôlée, la recherche documentaire locale et une exposition
MCP read-only via `search_docs`, `list_docs`, `read_doc_section` et des resources
catalogue. Le serveur n'embarque aucun LLM et ne requiert aucune API commerciale.

> Note budget CI : le workflow GitHub Actions est temporairement déclenchable
> uniquement manuellement via `workflow_dispatch`, afin d'éviter toute
> consommation automatique d'Actions minutes pendant l'épuisement du quota
> mensuel.

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
Crawl4AI. Le cache V1 et le catalogue V2 sont séparés : `.data/cache.db` reste
supprimable, `.data/catalog.db` porte le catalogue durable.

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

Le build nettoie `build/` et l'ancien dossier `dist/` avant compilation.
TypeScript utilise `noEmitOnError`, puis `npm start` exécute
`build/bootstrap/main.js`. Le processus utilise le transport MCP STDIO ; il
n’ouvre aucun port applicatif.

## Validation

Validation locale de référence pendant la suspension des Actions automatiques :

```bash
npm run check
npm run test:required
npm run test:unit
npm run test:contract
npm run test:security
npm run test:resilience
npm run test:performance
npm run test:integration
npm run test:e2e:deterministic
```

La suite d’intégration est déterministe et n’exige ni Internet ni Docker. Avec
les fournisseurs démarrés :

```bash
npm run test:e2e
```

`npm run check` inclut typecheck, lint, contrôle Prettier, build, tests
déterministes et seuils de couverture V8. Les rapports JSON sont écrits dans
`.data/test-reports`, et les rapports de couverture dans `coverage/`. Les
lanceurs de release échouent si un test requis est ignoré.

## Docker

Construire les images et démarrer les fournisseurs :

```bash
docker compose config
docker compose build
docker compose up -d searxng crawl4ai
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
capabilities supprimées et volume d’écriture limité au cache et au catalogue.
Aucun socket Docker, mode privilégié ou réseau hôte n’est utilisé.

## IntelliJ IDEA / GitHub Copilot

Le chemin exact de la configuration MCP dépend de la version d’IntelliJ et du
plugin GitHub Copilot. Dans l’écran de configuration MCP disponible dans votre
version, renseignez les champs génériques `command`, `args`, `env` et `cwd`.

Exécution Node locale, après `npm run build` :

```json
{
  "command": "node",
  "args": ["N:/chemin/vers/mcp-search-net/build/bootstrap/main.js"],
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

En V1, Copilot doit afficher `search_web` et `fetch_url`. En V2 documentaire, le
serveur expose aussi `search_docs` et des resources read-only de catalogue ; le
spike final IntelliJ/Copilot reste à exécuter avant gel définitif de l'ergonomie
V2. Voir le [guide IntelliJ détaillé](docs/getting-started/intellij-copilot.md)
et la [recette de spike MCP V2](docs/planning/spike-intellij-copilot-mcp-v2.md).

## Configuration

Les variables principales sont :

```text
MCP_CONFIG_PATH
MCP_LOG_LEVEL
MCP_CACHE_PATH
MCP_CATALOG_PATH
MCP_CATALOG_SOURCES_PATH
MCP_OFFICIAL_SOURCES_PATH
MCP_SEARXNG_URL
MCP_CRAWL4AI_URL
MCP_CRAWL4AI_TOKEN
MCP_ALLOWED_PUBLIC_PORTS
```

La priorité est : valeurs internes sûres, YAML, environnement, puis paramètres
d’outil dans les maxima absolus. Une configuration obligatoire invalide arrête le
démarrage avec un diagnostic sur `stderr`.

## Catalogue documentaire V2

Fonctionnalités en cours de stabilisation dans la PR #8 :

- catalogue durable séparé de `cache.db` ;
- migrations catalogue `C001` à `C007` avec checksums SHA-256 ;
- CLI `catalog init`, `status`, `verify`, `add-source`, `list-sources`,
  `load-sources`, `ingest-text`, `sync`, `search`, `rebuild-index`,
  `purge-versions` ;
- ingestion texte/Markdown avec versioning et sections ;
- recherche documentaire locale ;
- synchronisation contrôlée avec ETag, Last-Modified, hash, staleness et
  redirections permanentes ;
- outils MCP read-only `search_docs`, `list_docs` et `read_doc_section` ;
- resources MCP read-only pour catalogue, sources, documents, versions et
  sections.

## Sécurité

- seuls HTTP et HTTPS sont acceptés ;
- localhost, metadata cloud, réseaux privés/réservés, DNS mixte et redirections
  dangereuses sont bloqués avant connexion ;
- chaque redirection est résolue et validée à nouveau ;
- téléchargement limité à 10 Mo, cinq redirections et vingt secondes ;
- aucun JavaScript, hook, cookie, proxy, fichier ou identifiant fourni par
  l’appelant n’est accepté ;
- Crawl4AI reçoit le HTML contrôlé via `raw://`, jamais l’URL publique ;
- le contenu Web et documentaire reste une donnée non fiable et n’est jamais
  exécuté ;
- secrets, chemins internes et stacks ne sont pas renvoyés.

## Diagnostic rapide

| Symptôme                | Vérification                                                               |
| ----------------------- | -------------------------------------------------------------------------- |
| `stdout` corrompu       | rechercher un `console.log` ; seuls les logs JSON sur `stderr` sont permis |
| SearXNG répond 403      | vérifier que `json` est activé dans `config/searxng/settings.yml`          |
| Crawl4AI répond 401/403 | aligner `MCP_CRAWL4AI_TOKEN` et `CRAWL4AI_API_TOKEN`                       |
| healthcheck en échec    | `docker compose ps` puis `docker compose logs <service>`                   |
