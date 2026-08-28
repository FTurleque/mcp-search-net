# mcp-search-net

> **Licence propriétaire source-available — Tous droits réservés.** La visibilité publique du dépôt donne accès au code source mais ne transforme pas mcp-search-net en logiciel open source. Voir la section [Licence](#licence) et le fichier [`LICENSE`](LICENSE).

Serveur MCP local, en lecture seule, destiné aux clients MCP compatibles. Le périmètre de
certification native retenu couvre Claude Code, Claude Desktop et Codex. La compatibilité
IntelliJ IDEA / GitHub Copilot reste disponible pour les utilisateurs qui en ont besoin, mais elle
n'appartient plus au périmètre de certification du projet. La V1 expose deux outils Web stables :

- `search_web` découvre des pages avec SearXNG et privilégie les domaines du registre officiel ; en
  mode `strict`, la découverte est contrainte aux domaines vérifiés avant le filtrage final ;
- `fetch_url` récupère une URL publique connue, applique la protection SSRF, extrait du Markdown et
  limite les sections retournées.

La V2 documentaire est intégrée dans `master` depuis le 5 août 2026. Elle ajoute un catalogue local
séparé dans `catalog.db`, l’ingestion texte/Markdown, la synchronisation contrôlée, la recherche
documentaire locale et une exposition MCP read-only via `search_docs`, `list_docs`,
`read_doc_section` et des resources catalogue. Un historique local `history.sqlite` et l'outil
read-only `list_search_history` sont disponibles en **opt-in** ; les profils de production Windows
et Docker les désactivent par défaut. Le serveur n’embarque aucun LLM et ne requiert aucune API
commerciale.

La version de code courante est `1.1.5`. Une release n’est considérée qualifiée que si les checks
sont attachés au SHA exact du candidat. Une publication Windows exige en plus une certification
native 3/3 liée au SHA exact de `master` et une attestation GitHub de provenance. La signature
Authenticode (optionnelle, désactivée par défaut) reste une protection disponible : lorsqu'elle est
activée via les secrets de certificat configurés dans GitHub Actions, une signature valide et
horodatée est exigée avant publication ; une publication volontaire sans Authenticode reste
supportée mais n'offre pas la même preuve d'identité d'éditeur qu'un setup signé. L’état courant
autoritatif est décrit dans
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

Le domaine ne dépend ni du SDK MCP, ni de Zod, YAML, SQLite, SearXNG ou Crawl4AI. `cache.sqlite`,
`catalog.db` et, lorsqu'il est activé, `history.sqlite` sont des stockages séparés avec des
responsabilités et politiques de rétention distinctes.

## Prérequis

- Node.js 24 LTS et npm pour le développement depuis les sources ;
- Docker Desktop avec Docker Compose pour SearXNG et Crawl4AI ;
- un client MCP compatible pour l’intégration interactive ; Claude Code, Claude Desktop et Codex
  constituent le périmètre de certification native retenu.

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
Un fichier JSON client existant mais invalide n’est jamais remplacé silencieusement. La distribution
embarque le fichier `LICENSE` propriétaire et le setup le présente avant installation.

## Développement

```bash
docker compose -f compose.yaml -f compose.hybrid.yaml up -d searxng crawl4ai
npm run dev
```

L’overlay `compose.hybrid.yaml` publie SearXNG et Crawl4AI uniquement sur `127.0.0.1`, respectivement
sur les ports 8888 et 11235. Le serveur MCP écrit exclusivement le protocole JSON-RPC sur `stdout`
et ses diagnostics JSON sur `stderr`.

Le profil de développement active explicitement l'historique et `history.exposeTool: true` afin de
conserver le contrat de test complet à six outils. Les profils de production n'exposent que cinq
outils par défaut et n'enregistrent pas l'historique.

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

`npm run check` inclut les contrôles de licence propriétaire (`check:license`), supply chain et
documentation (`docs:check`), typecheck, lint, Prettier, build, tests déterministes et seuils de
couverture V8. Les entrypoints exécutés exclusivement en processus enfant sont exclus du compteur
V8 in-process mais restent verrouillés par des tests STDIO/subprocess dédiés. Les rapports JSON sont
écrits dans `.data/test-reports`, et les rapports de couverture dans `coverage/`. Un workflow planifié
exécute également chaque jour les audits npm complets et de production sur la branche par défaut.

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
volume d’écriture limité aux données SQLite applicatives. Aucun socket Docker, mode privilégié ou
réseau hôte n’est utilisé. Les images fournisseurs sont figées par digest SHA-256. L’image du serveur
porte le label OCI propriétaire `LicenseRef-mcp-search-net-Proprietary` et embarque `LICENSE`.

Le profil Docker de production utilise `history.enabled: false` et `history.exposeTool: false` :
`list_search_history` n'apparaît pas dans l'inventaire MCP tant que l'utilisateur ne choisit pas de
modifier explicitement cette politique.

## Compatibilité IntelliJ IDEA / GitHub Copilot

Le chemin exact de la configuration MCP dépend de la version d’IntelliJ et du plugin GitHub Copilot.
Cette intégration reste supportée à titre de compatibilité, sans faire partie du périmètre de
certification native courant. Avec `config/application.yml` de développement, le serveur expose six
outils : `search_web`, `fetch_url`, `search_docs`, `list_docs`, `read_doc_section` et
`list_search_history`. Avec les profils de production, `list_search_history` est absent par défaut.

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
MCP_HISTORY_PATH
MCP_OFFICIAL_SOURCES_PATH
MCP_SEARXNG_URL
MCP_CRAWL4AI_URL
MCP_CRAWL4AI_TOKEN
MCP_ALLOWED_PUBLIC_PORTS
```

La priorité est : valeurs internes sûres, YAML, environnement, puis paramètres d’outil dans les
maxima absolus. Une configuration obligatoire invalide arrête le démarrage avec un diagnostic sur
`stderr`.

L'historique utilise deux options distinctes : `history.enabled` contrôle la persistance et
`history.exposeTool` contrôle l'exposition de `list_search_history` aux clients MCP. Les deux valent
`false` dans les profils de production fournis. Une ancienne configuration sans `exposeTool` hérite
également de `false`.

## Catalogue documentaire V2

La V2 intégrée fournit :

- catalogue durable séparé de `cache.sqlite` ;
- migrations catalogue `C001` à `C014` avec checksums SHA-256 ;
- CLI `catalog init`, `status`, `verify`, `add-source`, `list-sources`, `load-sources`,
  `ingest-text`, `sync`, `search`, `rebuild-index`, `purge-versions`, ainsi que `health` et `backup` ;
- ingestion texte/Markdown avec versioning et sections ;
- recherche locale FTS5/BM25 ;
- synchronisation contrôlée avec ETag, Last-Modified, hash du payload HTTP brut, observations `304`,
  aliases, événements de staleness et redirections permanentes ;
- outils MCP read-only `search_docs`, `list_docs` et `read_doc_section` ;
- historique local persistant initialisé par `H001__create_search_history.sql`, activable séparément,
  et exposition read-only optionnelle via `list_search_history` ;
- resources MCP read-only paginées pour catalogue, sources, documents, versions et sections, avec
  lectures ciblées par identifiant, offsets bornés et budgets de réponse fixes.

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
- les erreurs MCP utilisent des messages publics canoniques et ne reflètent pas les métadonnées
  contrôlées par un serveur distant ;
- les fichiers SQLite persistants et leurs sidecars sont durcis sur POSIX ;
- l’installateur Windows vérifie le SHA-256 officiel et la signature OpenJS du runtime Node avant de
  l’activer ;
- la release Windows refuse toute divergence entre la version demandée et la version du dépôt ;
- une publication Windows depuis `master` exige une certification native `PASS_NATIVE_3_OF_3`
  correspondant au SHA exact, puis produit et revérifie une attestation GitHub de provenance avant
  la création de la release ; la signature Authenticode (optionnelle, désactivée par défaut) avec
  horodatage RFC 3161 est appliquée et vérifiée lorsque le candidat l'active ;
- secrets, chemins internes et stacks ne sont pas renvoyés.

## Diagnostic rapide

| Symptôme                | Vérification                                                               |
| ----------------------- | -------------------------------------------------------------------------- |
| `stdout` corrompu       | rechercher un `console.log` ; seuls les logs JSON sur `stderr` sont permis |
| SearXNG répond 403      | vérifier que `json` est activé dans `config/searxng/settings.yml`          |
| Crawl4AI répond 401/403 | aligner `MCP_CRAWL4AI_TOKEN` et `CRAWL4AI_API_TOKEN`                       |
| healthcheck en échec    | `docker compose ps` puis `docker compose logs <service>`                   |

## Licence

mcp-search-net est un logiciel **propriétaire source-available**. Copyright © 2026 Fabrice Turleque.
Tous droits réservés.

La publication du dépôt sur GitHub permet de consulter le code source et d’utiliser les fonctions de
la plateforme dans la mesure prévue par les conditions de GitHub ; elle ne constitue pas une licence
open source et n’accorde pas, de la part du titulaire des droits, un droit général d’utiliser,
d’exécuter, de déployer, de copier, de modifier, d’adapter, de redistribuer, de sous-licencier ou de
commercialiser mcp-search-net. Toute autorisation de ce type nécessite un accord écrit préalable du
titulaire des droits, sous réserve des droits qui ne peuvent légalement être exclus.

Les conditions complètes figurent dans [`LICENSE`](LICENSE). Les composants tiers et dépendances
restent soumis à leurs propres licences ; `THIRD-PARTY-NOTICES.txt` les distingue explicitement dans
les distributions publiées. Les contributions externes sont régies par [`CONTRIBUTING.md`](CONTRIBUTING.md).
