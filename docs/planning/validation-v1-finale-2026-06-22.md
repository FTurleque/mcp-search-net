# Validation finale V1 — 22 juin 2026

## 1. État initial

Le dépôt était propre sur `master`, sous Node.js 24.14.0. L’installation npm et
le build initial réussissaient déjà : aucune erreur de compilation initiale et
aucune vulnérabilité npm connue.

Les écarts confirmés par rapport à la mission étaient :

- scripts `clean`, `lint:fix` et `test:e2e` absents ;
- `week` accepté alors que l’API SearXNG officielle ne le prend pas en charge ;
- `allowedDomains` conférait à tort le statut `VERIFIED_OFFICIAL` ;
- contrat d’erreur sans champ `retryable` et deux warnings absents ;
- variables d’environnement non alignées sur le contrat demandé ;
- intégration dépendante de services Docker au lieu d’être déterministe ;
- service MCP masqué par un profil, donc `docker compose build` ne construisait rien ;
- port Crawl4AI inaccessible à l’application hôte tant que le conteneur restait
  exclusivement sur le réseau `internal` ;
- cache SQLite générique au lieu des tables V1 séparées ;
- lifecycle incomplet pour les erreurs fatales et `EPIPE` ;
- README racine trop court pour permettre une exploitation depuis un clone propre.

## 2. Fichiers créés

| Fichier                                            | Rôle                                                   |
| -------------------------------------------------- | ------------------------------------------------------ |
| `.gitattributes`                                   | LF pour code/docs et CRLF pour les scripts Windows     |
| script npm `clean` avec `rimraf`                   | nettoyage portable de `build` et de l'ancien `dist`    |
| `src/application/ports/dns-resolver.ts`            | port DNS injectable                                    |
| `src/infrastructure/security/node-dns-resolver.ts` | résolution DNS Node de toutes les adresses             |
| `src/domain/value-objects/web-url.ts`              | URL Web absolue et normalisée                          |
| `src/domain/value-objects/domain-name.ts`          | domaine normalisé et comparaison par frontière DNS     |
| `src/domain/value-objects/search-query.ts`         | validation et normalisation des requêtes               |
| `src/domain/value-objects/relevance-score.ts`      | score fini borné entre 0 et 1                          |
| `tests/domain/value-objects.test.ts`               | preuves unitaires des objets de valeur                 |
| `tests/e2e/services-live.test.ts`                  | fournisseurs réels, token Crawl4AI et mode `auto` hôte |
| `tests/e2e/mcp-docker-live.test.ts`                | MCP conteneurisé réel en STDIO                         |

## 3. Fichiers modifiés

| Fichier ou groupe                                      | Modification                                                                 |
| ------------------------------------------------------ | ---------------------------------------------------------------------------- |
| `package.json`                                         | scripts de nettoyage, correction lint, intégration, E2E et release           |
| `.env.example`, `config/application*.yml`              | contrat d’environnement sans secret réel                                     |
| `Dockerfile`, `compose.yaml`, `compose.hybrid.yaml`    | build MCP par défaut, images épinglées, loopback, token et moindre privilège |
| `config/searxng/settings.yml`                          | JSON activé et secret fourni par environnement                               |
| `src/domain/**`                                        | taxonomie, objets de valeur, warnings et contrat d’erreur V1                 |
| `src/application/**`                                   | ports DNS/fournisseurs et officialité réservée au registre                   |
| `src/infrastructure/config/**`                         | schéma Zod d’environnement et priorités documentées                          |
| `src/infrastructure/cache/**`                          | tables `search_cache`, `content_cache`, migrations et pragmas SQLite         |
| `src/infrastructure/security/**`                       | résolveur DNS explicite et politique SSRF conservée                          |
| `src/infrastructure/fetch/crawl4ai-content-fetcher.ts` | transport `raw://` et suppression des ressources chargeables                 |
| `src/infrastructure/search/searxng-search-provider.ts` | contrat officiel `pageno=1` et périodes prises en charge                     |
| `src/presentation/mcp/**`                              | descriptions, schémas et erreurs MCP alignés                                 |
| `src/bootstrap/main.ts`                                | `.env`, signaux, exceptions, rejets et `EPIPE`                               |
| `tests/**`, `vitest*.config.ts`                        | suites déterministes et E2E réels sans skip                                  |
| `.github/workflows/ci.yml`                             | build conteneur et E2E Docker complets                                       |
| `README.md`, `docs/**`                                 | installation, Docker, IntelliJ, contrats, sécurité et preuves                |

Le fichier live précédemment placé sous `tests/integration` a été remplacé par
`tests/e2e/services-live.test.ts` afin que l’intégration reste hors réseau.

### Commits logiques proposés

1. `feat: align V1 domain application and MCP contracts`
2. `feat: harden providers SSRF bootstrap and SQLite cache`
3. `build: finalize Docker Compose tooling and CI`
4. `test: add deterministic integration and live MCP e2e coverage`
5. `docs: document and validate the complete V1 release`

Aucun commit n’a été créé automatiquement.

## 4. Versions retenues

| Composant          | Version                               | Source officielle                                                                         | Justification                                    |
| ------------------ | ------------------------------------- | ----------------------------------------------------------------------------------------- | ------------------------------------------------ |
| Node.js            | 24 LTS ; local 24.14.0, image 24.17.0 | [nodejs.org](https://nodejs.org/)                                                         | runtime moderne imposé par le projet             |
| SDK MCP TypeScript | 1.29.0                                | [branche V1 officielle](https://github.com/modelcontextprotocol/typescript-sdk/tree/v1.x) | V1 stable, `McpServer`, `registerTool`, STDIO    |
| TypeScript         | 5.9.3                                 | [typescriptlang.org](https://www.typescriptlang.org/)                                     | ESM NodeNext et strict complet                   |
| Zod                | 4.4.3                                 | [zod.dev](https://zod.dev/)                                                               | compatible SDK MCP V1 et schémas stricts         |
| better-sqlite3     | 12.11.1                               | [dépôt officiel](https://github.com/WiseLibs/better-sqlite3)                              | cache SQLite synchrone et préparé                |
| SQLite             | fourni par better-sqlite3             | [sqlite.org](https://sqlite.org/)                                                         | WAL, foreign keys, busy timeout et migrations    |
| SearXNG            | digest `d0f6ccf…b7082`                | [documentation API](https://docs.searxng.org/dev/search_api.html)                         | image testée, API JSON et périodes officielles   |
| Crawl4AI           | 0.9.0, digest `385042c…e644`          | [dépôt officiel](https://github.com/unclecode/crawl4ai)                                   | release sécurisée, token et frontière non fiable |
| Vitest             | 4.1.9                                 | [vitest.dev](https://vitest.dev/)                                                         | suites unitaires, intégration et E2E séparées    |

`npm install` a résolu 278 paquets sans vulnérabilité connue. Aucun changement de
version non nécessaire n’a été introduit.

## 5. Commandes exécutées

| Commande                                | Résultat                                                 |
| --------------------------------------- | -------------------------------------------------------- |
| `npm install`                           | succès, 0 vulnérabilité                                  |
| `npm run format:check`                  | succès                                                   |
| `npm run lint`                          | succès, 0 warning                                        |
| `npm run build`                         | succès                                                   |
| `npm run test:unit`                     | succès, 62 tests, 0 ignoré                               |
| `npm run test:integration`              | succès, 25 tests, 0 ignoré, sans Docker                  |
| `npm test`                              | succès, 134 tests sur 21 fichiers                        |
| `docker compose config`                 | succès                                                   |
| `docker compose build`                  | succès, image `mcp-search-net:1.0.0` construite          |
| `docker compose up -d searxng crawl4ai` | succès                                                   |
| `docker compose ps`                     | SearXNG et Crawl4AI `healthy`, ports loopback uniquement |
| `npm run test:e2e`                      | succès, 7 tests réels, 0 ignoré                          |
| `docker compose down`                   | succès                                                   |

La première passe de livraison s’est arrêtée sur `format:check` pour deux fichiers
nouveaux. `npm run format` les a corrigés, puis la chaîne complète ci-dessus a été
relancée depuis `npm install` et a réussi jusqu’à `docker compose down`.

## 6. Tests fonctionnels

| Scénario                  | Preuve                       | Résultat                                           |
| ------------------------- | ---------------------------- | -------------------------------------------------- |
| Recherche standard        | E2E MCP + SearXNG réel       | succès, enveloppe structurée et texte              |
| Mode strict sans officiel | test `SearchWeb`             | succès vide + `NO_VERIFIED_OFFICIAL_SOURCE`        |
| Domaines autorisés        | test `SearchWeb`             | filtrage actif, aucun statut officiel induit       |
| Domaines exclus           | test `SearchWeb`             | exclusion prioritaire                              |
| Récupération URL          | E2E `fetch_url`              | Markdown, sections et URL conservées               |
| Redirection               | passerelle + use case        | chaque saut validé et `REDIRECTED_URL`             |
| URL privée                | suites SSRF                  | `BLOCKED_ADDRESS`, aucune connexion interdite      |
| Contenu volumineux        | passerelle sécurisée         | `RESPONSE_TOO_LARGE` avant dépassement             |
| Cache HIT/MISS            | tests use cases et SQLite    | statuts exacts, revalidation et stale fallback     |
| Page dynamique            | adaptateur Crawl4AI 0.9 réel | `raw://`, token et mode `native-render` validés    |
| MCP STDIO                 | client SDK hôte et Docker    | exactement deux outils, stdout JSON-RPC uniquement |

## 7. Limites restantes

- La recette visuelle dans l’interface GitHub Copilot d’IntelliJ doit encore être
  exécutée par un opérateur connecté au plugin. Les contrats STDIO, les deux outils,
  les configurations Node/Docker et le serveur conteneurisé sont automatisés, mais
  aucune capture UI ne peut être produite dans cet environnement.
- La pertinence et la fraîcheur des résultats dépendent des moteurs SearXNG actifs
  et de leurs métadonnées ; les warnings rendent ces limites visibles.

## 8. Verdict final

**V1 OPÉRATIONNELLE AVEC RÉSERVES**

La réserve porte uniquement sur la preuve manuelle IntelliJ/Copilot. La chaîne
locale, déterministe, Docker, fournisseurs réels et MCP STDIO est validée.
