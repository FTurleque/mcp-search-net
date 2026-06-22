# Validation finale V1 et décision V2 — 22 juin 2026

## 1. Baseline initiale

| Commande                                            | Résultat initial                                                                             |
| --------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `git status --short`                                | dépôt propre avant cette mission, branche `master`, commit `7a5dd1b`                         |
| `node --version` via le PATH système                | `v18.16.1`, non conforme à Node 24                                                           |
| `node --version` avec le runtime Node 24 disponible | `v24.14.0`                                                                                   |
| `npm --version`                                     | `11.9.0`                                                                                     |
| `npm install`                                       | succès, dépendances déjà à jour                                                              |
| `npm run build`                                     | succès                                                                                       |
| `npm test`                                          | 134 tests initiaux réussis sur 21 fichiers                                                   |
| `docker compose config`                             | succès ; avertissement local non bloquant sur l'accès à `C:\Users\fturl\.docker\config.json` |

Écarts confirmés au départ : sélection BM25 locale désormais hors périmètre, port cache générique ne respectant pas les six méthodes imposées, ports fournisseurs sans value objects, table `temporary_error_cache`, absence d'ADR de frontière V1/V2 et absence de `MCP_ALLOWED_PUBLIC_PORTS`.

## 2. Fichiers créés

| Fichier                                                 | Rôle                                                                     |
| ------------------------------------------------------- | ------------------------------------------------------------------------ |
| `migrations/V001__create_schema_migrations.sql`         | registre transactionnel des migrations                                   |
| `migrations/V002__create_search_cache.sql`              | table et index du cache de recherche                                     |
| `migrations/V003__create_content_cache.sql`             | table et index du cache de contenu                                       |
| `migrations/V004__remove_legacy_cache_tables.sql`       | compatibilité : suppression des anciennes tables générique et temporaire |
| `src/application/ports/logger.ts`                       | port applicatif de journalisation structurée                             |
| `docs/adr/ADR-011-v1-v2-boundary.md`                    | frontière cache V1/catalogue V2 et gel des contrats publics              |
| `docs/planning/validation-v1-v2-go-no-go-2026-06-22.md` | présent rapport de preuve                                                |

## 3. Fichiers modifiés

| Fichier ou groupe                                                       | Modification                                                                                                    |
| ----------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `package.json`, `package-lock.json`, `tsconfig.json`                    | ordre de `check`, `@types/node` exact, cible ES2022                                                             |
| `Dockerfile`, `scripts/install-user.ps1`                                | embarquement reproductible des migrations SQL                                                                   |
| `.github/workflows/ci.yml`                                              | étapes explicites format, lint, build, unitaires et intégration                                                 |
| `src/application/ports/*`                                               | contrats typés `SearchProvider`, `ContentFetcher`, `CacheRepository`, `Logger` et télémétrie                    |
| `src/application/use-cases/*`                                           | pipelines cache/fournisseurs, value objects, limites réseau et événements stables                               |
| `src/domain/errors/domain-errors.ts`                                    | taxonomie d'erreurs V1 complète                                                                                 |
| `src/domain/services/content-selection.ts`                              | remplacement de BM25 par un score lexical déterministe borné 0–1                                                |
| `src/domain/value-objects/*`                                            | URL limitée à 4096 caractères et normalisation de requête limitée aux espaces                                   |
| `src/infrastructure/cache/*`                                            | six méthodes du port, deux caches séparés, migrations SQL extensibles, WAL et nettoyage                         |
| `src/infrastructure/config/*`, `config/*`, `.env.example`               | validation Zod de `MCP_ALLOWED_PUBLIC_PORTS`, retrait du TTL temporaire                                         |
| `src/infrastructure/search/*`                                           | `SearchQuery`, `maxResults`, retry unique 429/5xx, erreurs typées                                               |
| `src/infrastructure/fetch/*`                                            | `ContentFetchRequest`, limites effectives, token Crawl4AI et erreurs typées                                     |
| `src/infrastructure/security/*`                                         | erreurs SSRF, DNS et ports spécialisées                                                                         |
| `src/infrastructure/logging/*`, `src/bootstrap/*`, `src/presentation/*` | port Logger, événements, diagnostics `stderr`, limites publiques                                                |
| `tests/**/*`                                                            | contrats, 403/429/500, token/indisponibilité Crawl4AI, migrations exactes, ports, SSRF MCP, cache MISS/HIT live |
| `README.md`, `docs/**/*`                                                | contrats, cache V1, sélection lexicale, configuration, observabilité et frontière V2                            |

## 4. Versions retenues

| Composant          | Package ou image             |                                 Version exacte | Source officielle                                                                                 | Justification                                                |
| ------------------ | ---------------------------- | ---------------------------------------------: | ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| Node.js cible      | runtime, `.nvmrc`, Docker    |                            24.17.0 LTS Krypton | [Node.js releases](https://nodejs.org/en/download)                                                | dernier Node 24 LTS vérifié le 22 juin 2026                  |
| SDK MCP TypeScript | `@modelcontextprotocol/sdk`  |                                         1.29.0 | [release officielle](https://github.com/modelcontextprotocol/typescript-sdk/releases/tag/v1.29.0) | dernière V1 stable ; API STDIO compilée et testée            |
| TypeScript         | `typescript`                 |                                          5.9.3 | [TypeScript 5.9](https://devblogs.microsoft.com/typescript/announcing-typescript-5-9/)            | stable ; aucune migration risquée vers TypeScript 6          |
| Types Node         | `@types/node`                |                                        24.13.2 | [DefinitelyTyped](https://github.com/DefinitelyTyped/DefinitelyTyped/tree/master/types/node)      | majeur aligné sur Node 24, version exacte                    |
| Zod                | `zod`                        |                                          4.4.3 | [Zod](https://zod.dev/)                                                                           | frontières externes strictes                                 |
| SQLite natif       | `better-sqlite3`             |                                        12.11.1 | [better-sqlite3](https://github.com/WiseLibs/better-sqlite3)                                      | cache local synchrone et transactionnel                      |
| SQLite embarqué    | bibliothèque native          |                                         3.53.2 | [SQLite](https://sqlite.org/)                                                                     | version réellement retournée par `sqlite_version()`          |
| Vitest             | `vitest`                     |                                          4.1.9 | [Vitest](https://vitest.dev/)                                                                     | suites déterministes et live                                 |
| SearXNG            | image OCI                    | digest `d0f6ccf…b7082` (`2026.6.20-fd42d4fda`) | [SearXNG](https://docs.searxng.org/)                                                              | image immuable et JSON vérifié                               |
| Crawl4AI           | image OCI                    |                        digest `385042cb…5e644` | [Crawl4AI](https://github.com/unclecode/crawl4ai)                                                 | image immuable, endpoint santé et rendu authentifié vérifiés |
| Image Node         | `node:24.17.0-bookworm-slim` |                        digest `c2d5ade7…f780a` | [Node Docker Official Image](https://hub.docker.com/_/node)                                       | runtime fixé, multi-stage, non-root                          |

`npm outdated` a signalé des majeures non retenues (`eslint` 10, TypeScript 6, types Node 26) et quelques mises à jour non critiques. Elles ne sont pas introduites pendant la stabilisation. `npm audit --omit=dev --audit-level=high` retourne 0 vulnérabilité. Le paquet transitif `prebuild-install@7.1.3` émet un avertissement de dépréciation sans vulnérabilité connue.

## 5. Commandes exécutées

| Commande                                      | Résultat                                                                                 |
| --------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `npm ci`                                      | succès, 277 paquets installés depuis le lockfile                                         |
| `npm run format:check`                        | succès                                                                                   |
| `npm run lint`                                | succès, 0 warning                                                                        |
| `npm run build`                               | succès                                                                                   |
| `npm run test:unit`                           | 62 réussis, 0 ignoré                                                                     |
| `npm run test:integration`                    | 29 réussis, 0 ignoré                                                                     |
| `npm test`                                    | 139 réussis sur 21 fichiers                                                              |
| `npm run check`                               | succès sous Node 24.14.0                                                                 |
| `npm run test:required`                       | 139 réussis, 0 ignoré                                                                    |
| `npm run test:contract`                       | 6 réussis, 0 ignoré                                                                      |
| `npm run test:security`                       | 61 réussis, 0 ignoré                                                                     |
| `npm run test:resilience`                     | 25 réussis, 0 ignoré                                                                     |
| `npm run test:performance`                    | 2 réussis, 0 ignoré                                                                      |
| `npm outdated --json`                         | audit effectué ; mises à jour majeures volontairement différées                          |
| `npm audit --omit=dev --audit-level=high`     | 0 vulnérabilité                                                                          |
| `docker compose config`                       | succès ; dépendances `service_healthy` confirmées                                        |
| `docker compose build`                        | succès, image `mcp-search-net:1.0.0` reconstruite                                        |
| `docker compose up -d searxng crawl4ai`       | succès                                                                                   |
| `docker compose ps`                           | deux fournisseurs `healthy`, ports uniquement sur `127.0.0.1`                            |
| smoke SearXNG JSON                            | HTTP 200, réponse JSON avec 10 à 16 résultats selon l'appel                              |
| healthcheck Crawl4AI                          | HTTP 200                                                                                 |
| premier `npm run test:e2e` après durcissement | 6/7 : l'assertion live `strict` exigeait à tort au moins un résultat externe             |
| correction puis `npm run test:e2e`            | 7/7, 0 ignoré ; scénario standard `any`, `strict` restant déterministe                   |
| `docker compose down`                         | succès, aucun conteneur du projet restant                                                |
| `scripts/test-installation.ps1` direct        | `INSTALLATION_LIFECYCLE_VALID` ; installation, réinstallation et désinstallation isolées |
| recherche de sorties stdout parasites         | aucune occurrence dans `src`                                                             |
| `git diff --check`                            | succès ; seul avertissement informatif LF/CRLF du script PowerShell                      |

La tentative de lancer `powershell.exe -File scripts/test-installation.ps1` n'a pas démarré car ce binaire n'existe pas dans l'environnement isolé. L'exécution directe du même script dans la session PowerShell disponible a ensuite réussi intégralement.

## 6. Tests fonctionnels

| Scénario                 | Résultat                                                                                                |
| ------------------------ | ------------------------------------------------------------------------------------------------------- |
| `tools/list`             | exactement `fetch_url` et `search_web`, en hôte et via `docker compose run --rm -T`                     |
| recherche standard       | succès live via SearXNG avec enveloppe et `structuredContent`                                           |
| politique `strict`       | tests déterministes : uniquement `VERIFIED_OFFICIAL`, ou succès vide avec `NO_VERIFIED_OFFICIAL_SOURCE` |
| domaine autorisé         | whitelist appliquée sans promotion en source officielle                                                 |
| domaine exclu            | exclusion prioritaire sur autorisation                                                                  |
| récupération URL         | succès live sur `https://example.com`, Markdown et métadonnées conservés                                |
| redirection publique     | chaque cible et URL finale sont revalidées                                                              |
| URL privée bloquée       | appel MCP live vers `http://127.0.0.1/private` rejeté avec `BLOCKED_ADDRESS`                            |
| port non autorisé bloqué | `8443` rejeté avec la configuration par défaut                                                          |
| port configuré accepté   | `8443` accepté uniquement via la liste validée                                                          |
| cache MISS               | premier appel live avec SQLite temporaire isolé : `MISS`                                                |
| cache HIT                | second appel identique : `HIT`                                                                          |
| contenu tronqué          | budgets globaux/par section et warnings testés                                                          |
| arrêt propre             | fermeture client, signaux, `server_stopped`, EPIPE et `docker compose down` testés                      |
| fallback texte           | présent et validé avec `structuredContent` dans les tests MCP                                           |
| stdout/stderr            | stdout JSON-RPC uniquement ; diagnostics JSON et secrets expurgés sur stderr                            |

## 7. Frontière V1 / V2

- Tables V1 : `schema_migrations`, `search_cache`, `content_cache` uniquement.
- Les tables réservées V2 (`documents`, `document_versions`, `document_sections`, `sources`, `index`, `fts`) ne sont pas créées.
- Les migrations `V001` à `V004` sont ordonnées, transactionnelles et extensibles.
- Les contrats publics `search_web` et `fetch_url` sont gelés dans l'ADR-011.
- Le cache V1 reste opportuniste et supprimable ; aucun catalogue ou index métier ne le réutilise.
- Aucun FTS5, BM25, OCR, embedding, catalogue, synchronisation ou outil V2 n'est implémenté.

## 8. Limites restantes

1. Le worktree courant n'est pas commité ni publié. Le workflow GitHub Actions ne peut donc pas fournir un statut vert sur ces modifications sans commit/push, actions non autorisées par cette mission. Les commandes équivalentes de la CI et l'E2E Docker ont toutes été exécutées localement.
2. La recette visuelle dans IntelliJ/GitHub Copilot n'a pas été rejouée manuellement ; le client MCP officiel et les configurations Copilot ont été validés automatiquement.
3. Le PATH système de cette session reste sur Node 18.16.1. Le dépôt, Docker, l'installateur et les tests utilisent Node 24 ; l'utilisateur doit activer `.nvmrc`/`.node-version` ou le runtime installé.
4. `prebuild-install@7.1.3`, dépendance transitive de l'écosystème natif, est dépréciée. L'audit de production retourne néanmoins 0 vulnérabilité.

## 9. Verdict V1

```text
V1 OPÉRATIONNELLE AVEC RÉSERVES
```

La compilation, les 139 tests déterministes, les suites sécurité/résilience/performance, les migrations, l'installation Windows, Docker, les fournisseurs réels et les 7 scénarios E2E MCP STDIO sont validés. La réserve est exclusivement l'absence de statut GitHub Actions sur le worktree non publié, complétée par la recette IntelliJ manuelle non rejouée.

## 10. Décision V2

```text
V2 BUILD NO-GO
```

| Critère V2                      | Décision                                             |
| ------------------------------- | ---------------------------------------------------- |
| validations critiques V1        | réussies localement                                  |
| `search_web` / `fetch_url`      | validés en MCP STDIO live                            |
| contrats publics figés          | oui, ADR-011                                         |
| cache et migrations extensibles | oui                                                  |
| séparation cache/catalogue V2   | oui                                                  |
| SSRF, redirects et ports        | validés                                              |
| Docker reproductible            | validé                                               |
| CI verte sur ces modifications  | **non disponible : worktree non commité/non publié** |
| dette critique de migration V2  | aucune détectée hors preuve CI manquante             |

Le critère explicite « CI verte » n'est pas démontré pour ces modifications. La V2 reste donc bloquée jusqu'à ce qu'un commit soit soumis et que les deux jobs GitHub Actions soient verts. Aucun développement V2 n'a commencé pendant cette mission.
