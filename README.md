# mcp-search-net

Serveur MCP local, en lecture seule, destiné notamment à GitHub Copilot dans IntelliJ IDEA. La V1
expose deux outils Web stables :

- `search_web` découvre des pages avec SearXNG et privilégie les domaines du registre officiel ;
- `fetch_url` récupère une URL publique connue, applique la protection SSRF, extrait du Markdown et
  limite les sections retournées.

La V2 documentaire est intégrée dans `master` depuis le 5 août 2026. Elle ajoute un catalogue local
séparé dans `catalog.db`, l’ingestion texte/Markdown, la synchronisation contrôlée, la recherche
documentaire locale et une exposition MCP read-only via `search_docs`, `list_docs`,
`read_doc_section` et des resources catalogue. Le serveur n’embarque aucun LLM et ne requiert
aucune API commerciale.

La version de code courante est `1.1.0`. Une release n’est considérée qualifiée que si les checks
sont attachés au SHA exact du candidat. L’état courant autoritatif est décrit dans
[`docs/status/current-state.md`](docs/status/current-state.md).

## Architecture

Le dépôt suit une architecture hexagonale simplifiée :

```text
src/domain          modèles, objets de valeur et règles déterministes
src/application     ports et cas d’usage
src/infrastructure  SearXNG, Crawl4AI, SQLite, configuration, DNS et logs
src/presentation    serveur, schémas et mapping MCP
src/bootstrap       assemblage et cycle de vie STDIO
```

Le domaine ne dépend ni du SDK MCP, ni de Zod, YAML, SQLite, SearXNG ou Crawl4AI. Le cache V1 et le
catalogue V2 sont séparés : `.data/cache.sqlite` reste supprimable, `.data/catalog.db` porte le
catalogue durable.

## Prérequis

- Node.js 24 LTS et npm pour le développement depuis les sources ;
- Docker Desktop avec Docker Compose pour SearXNG et Crawl4AI ;
- IntelliJ IDEA et GitHub Copilot si cette intégration est utilisée.

## Installation depuis les sources

```bash
npm install
cp .env.example .env
```

Sous Windows, copiez manuellement `.env.example` vers `.env`. Remplacez `CRAWL4AI_API_TOKEN` et
`SEARXNG_SECRET` par des valeurs aléatoires locales : Compose refuse de démarrer si elles sont
absentes. Un profil autre que `development` refuse aussi les jetons d’exemple connus.

Le pipeline Windows produit également un ZIP portable et un setup Inno Setup. L’installateur
préserve les entrées MCP client préexistantes qu’il ne gère pas, sauvegarde les fichiers avant
modification et ne supprime à la désinstallation que les intégrations enregistrées comme `managed`.
Un fichier JSON client existant mais invalide n’est jamais remplacé silencieusement.

## Développement

```bash
docker compose -f compose.yaml -f compose.hybrid.yaml up -d searxng crawl4ai
npm run dev
```

L’overlay `compose.hybrid.yaml` publie SearXNG et Crawl4AI uniquement sur `127.0.0.1`, respectivement
sur les ports 8888 et 11235. Le serveur MCP écrit exclusivement le protocole JSON-RPC sur `stdout`
et ses diagnostics JSON sur `stderr`.

## Build et exécution locale

```bash
npm run build
npm start
```

Le build nettoie `build/` et l’ancien dossier `dist/` avant compilation. TypeScript utilise
`noEmitOnError`, puis `npm start` exécute `build/bootstrap/main.js`. Le processus utilise le transport
MCP STDIO ; il n’ouvre aucun port applicatif.

## Validation

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

La suite d’intégration déterministe n’exige ni Internet ni Docker. Avec les fournisseurs démarrés :

```bash
npm run test:e2e
```

`npm run check` inclut les contrôles supply chain et documentation (`docs:check`), typecheck, lint,
Prettier, build, tests déterministes et seuils de couverture V8. Les rapports JSON sont écrits dans
`.data/test-reports`, et les rapports de couverture dans `coverage/`.

## Docker

Construire les images et démarrer les fournisseurs :

```bash
docker compose config
docker compose build
docker compose up -d searxng crawl4ai
```

Exécuter le serveur MCP conteneurisé en STDIO :

```bash
docker compose --profile stdio run --rm -T mcp-search-net
```

Arrêter la stack :

```bash
docker compose down
```

Le conteneur MCP s’exécute sans root, avec filesystem en lecture seule, capabilities supprimées et
volume d’écriture limité au cache et au catalogue. Aucun socket Docker, mode privilégié ou réseau
hôte n’est utilisé. Les images fournisseurs sont figées par digest SHA-256.

## IntelliJ IDEA / GitHub Copilot

Le chemin exact de la configuration MCP dépend de la version d’IntelliJ et du plugin GitHub Copilot.
Le serveur expose cinq outils : `search_web`, `fetch_url`, `search_docs`, `list_docs` et
`read_doc_section`.

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

Les resources catalogue sont un canal read-only complémentaire ; leur affichage et leur exploitation
directe dépendent du client MCP. Le workflow portable recommandé reste `search_docs`, sélection de
1 à 3 résultats, puis `read_doc_section`. Voir le
[guide IntelliJ détaillé](docs/getting-started/intellij-copilot.md).

## Configuration

Les variables principales sont :

```text
MCP_CONFIG_PATH
MCP_PROFILE
MCP_LOG_LEVEL
MCP_CACHE_PATH
MCP_CATALOG_PATH
MCP_OFFICIAL_SOURCES_PATH
MCP_SEARXNG_URL
MCP_CRAWL4AI_URL
MCP_CRAWL4AI_TOKEN
MCP_ALLOWED_PUBLIC_PORTS
```

La priorité est : valeurs internes sûres, YAML, environnement, puis paramètres d’outil dans les
maxima absolus. Une configuration obligatoire invalide arrête le démarrage avec un diagnostic sur
`stderr`.

## Catalogue documentaire V2

La V2 intégrée fournit :

- catalogue durable séparé de `cache.sqlite` ;
- migrations catalogue `C001` à `C008` avec checksums SHA-256 ;
- CLI `catalog init`, `status`, `verify`, `add-source`, `list-sources`, `load-sources`,
  `ingest-text`, `sync`, `search`, `rebuild-index`, `purge-versions`, ainsi que `health` et `backup` ;
- ingestion texte/Markdown avec versioning et sections ;
- recherche locale FTS5/BM25 ;
- synchronisation contrôlée avec ETag, Last-Modified, hash du payload HTTP brut, observations `304`,
  aliases, événements de staleness et redirections permanentes ;
- outils MCP read-only `search_docs`, `list_docs` et `read_doc_section` ;
- resources MCP read-only paginées pour catalogue, sources, documents, versions et sections, avec
  lectures ciblées par identifiant et budgets de réponse fixes.

Le benchmark V2.13 montre que la baseline lexicale est efficace sur les identifiants et termes
explicites mais reste faible sur les paraphrases et les questions multi-document. Le reranker lexical
hashé n’a pas montré de gain et n’est pas généralisé.

## Sécurité

- seuls HTTP et HTTPS sont acceptés ;
- localhost, metadata cloud, réseaux privés/réservés, DNS mixte et redirections dangereuses sont
  bloqués avant connexion ;
- chaque redirection est résolue et validée à nouveau ;
- la connexion est épinglée sur une adresse DNS préalablement approuvée ;
- téléchargement limité à 10 Mo, cinq redirections et vingt secondes ;
- `robots.txt` est appliqué avec prise en charge des jokers `*`, de l’ancre terminale `$` et de la
  priorité `Allow` à spécificité égale ;
- aucun JavaScript, hook, cookie, proxy, fichier ou identifiant fourni par l’appelant n’est accepté ;
- Crawl4AI reçoit le HTML contrôlé via `raw://`, jamais l’URL publique ;
- le contenu Web et documentaire reste une donnée non fiable et n’est jamais exécuté ; les réponses
  structurées le marquent `EXTERNAL_UNTRUSTED_CONTENT` ;
- l’installateur Windows vérifie le SHA-256 officiel et la signature OpenJS du runtime Node avant de
  l’activer ;
- la release Windows refuse toute divergence entre la version demandée et la version du dépôt ;
- secrets, chemins internes et stacks ne sont pas renvoyés.

## Diagnostic rapide

| Symptôme                | Vérification                                                               |
| ----------------------- | -------------------------------------------------------------------------- |
| `stdout` corrompu       | rechercher un `console.log` ; seuls les logs JSON sur `stderr` sont permis |
| SearXNG répond 403      | vérifier que `json` est activé dans `config/searxng/settings.yml`          |
| Crawl4AI répond 401/403 | aligner `MCP_CRAWL4AI_TOKEN` et `CRAWL4AI_API_TOKEN`                       |
| healthcheck en échec    | `docker compose ps` puis `docker compose logs <service>`                   |
