# Matrice de traçabilité V1

Cette matrice relie les exigences du cahier des charges au code, aux preuves
automatisées et aux critères d’acceptation. Les chemins sont relatifs à la racine
du dépôt.

## Exigences fonctionnelles

| Exigence                                 | Réalisation principale                                                                                         | Preuves                                                                                                      | AC                         |
| ---------------------------------------- | -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ | -------------------------- |
| F-001 — serveur MCP STDIO et deux outils | `src/presentation/mcp/mcp-server.ts`, `src/bootstrap/main.ts`                                                  | `tests/e2e/mcp-stdio.test.ts`, `tests/e2e/mcp-live*.test.ts`                                                 | AC-02, AC-03               |
| F-002 — recherche Web                    | `src/application/use-cases/search-web.ts`, `src/infrastructure/search/searxng-search-provider.ts`              | `tests/application/search-web.test.ts`, `tests/infrastructure/searxng-search-provider.test.ts`               | AC-04, AC-06, AC-07, AC-08 |
| F-003 — récupération ciblée              | `src/application/use-cases/fetch-url.ts`, `src/infrastructure/fetch/crawl4ai-content-fetcher.ts`               | `tests/application/fetch-url.test.ts`, `tests/infrastructure/crawl4ai-content-fetcher.test.ts`               | AC-05, AC-06, AC-09        |
| F-004 — contrat de réponse commun        | `src/domain/models/tool-response.ts`, `src/presentation/mcp/tool-call.ts`                                      | `tests/presentation/tool-response-schema.test.ts`, `tests/presentation/tool-call.test.ts`                    | AC-06, AC-10               |
| F-005 — cache local                      | `src/infrastructure/cache/sqlite-cache-repository.ts`, `safe-cache-repository.ts`                              | `tests/infrastructure/sqlite-cache-repository.test.ts`, `tests/integration/services.integration.test.ts`     | AC-10                      |
| F-006 — sources officielles              | `src/infrastructure/config/official-source-yaml-registry.ts`, `src/domain/services/result-ranking.ts`          | `tests/infrastructure/official-source-yaml-registry.test.ts`, `tests/domain/result-ranking.test.ts`          | AC-07, AC-08               |
| F-007 — réduction du contexte            | `src/domain/services/content-selection.ts`                                                                     | `tests/domain/content-selection.test.ts`, `tests/application/fetch-url.test.ts`                              | AC-05, AC-09               |
| F-008 — sécurité réseau                  | `src/infrastructure/security/public-url-security-policy.ts`, `src/infrastructure/fetch/secure-http-gateway.ts` | `tests/infrastructure/public-url-security-policy.test.ts`, `secure-http-gateway.test.ts`, `tests/security/*` | AC-11, AC-13               |
| F-009 — configuration et exploitation    | `src/infrastructure/config/*`, `compose.yaml`, `scripts/install-user.ps1`                                      | `tests/infrastructure/application-config.test.ts`, `scripts/test-installation.ps1`                           | AC-01, AC-12, AC-15        |
| F-010 — observabilité sûre               | `src/infrastructure/logging/structured-logger.ts`, `src/presentation/mcp/tool-call.ts`                         | `tests/presentation/tool-call.test.ts`, `tests/e2e/mcp-stdio.test.ts`                                        | AC-13, AC-14               |

## Objectifs techniques de l’annexe C

| Objectif                                    | Code                                                      | Tests                                                           | AC           |
| ------------------------------------------- | --------------------------------------------------------- | --------------------------------------------------------------- | ------------ |
| OBJ-001 — présentation MCP                  | `src/presentation/mcp`, `src/bootstrap`                   | `tests/e2e/mcp-stdio.test.ts`                                   | AC-03        |
| OBJ-002 — `SearchWeb` et SearXNG            | `search-web.ts`, `searxng-search-provider.ts`             | suites application, infrastructure et intégration               | AC-04, AC-07 |
| OBJ-003 — `FetchUrl` et Crawl4AI            | `fetch-url.ts`, `crawl4ai-content-fetcher.ts`             | suites application, infrastructure, formats et intégration      | AC-05, AC-09 |
| OBJ-004 — DTO et mappers                    | `src/domain/models`, `src/presentation/mcp/schemas`       | suites présentation et contrat                                  | AC-06        |
| OBJ-005 — budgets de contexte               | `content-selection.ts`, schéma `fetch_url`                | `content-selection.test.ts`, `fetch-url-schema.test.ts`         | AC-04, AC-05 |
| OBJ-006 — dépendances et configuration      | `container.ts`, `src/infrastructure/config`               | `application-config.test.ts`, `configuration-injection.test.ts` | AC-12        |
| OBJ-007 — sécurité URL                      | `public-url-security-policy.ts`, `secure-http-gateway.ts` | suites sécurité et passerelle                                   | AC-11        |
| OBJ-008 — préparation V2 sans l’implémenter | ports applicatifs, séparation hexagonale, ADR-010         | revue d’architecture ; absence d’outil ou d’index V2            | hors AC V1   |

## Couverture des critères d’acceptation

| AC            | Preuve reproductible                                                            |
| ------------- | ------------------------------------------------------------------------------- |
| AC-01         | `docker compose config --quiet`, healthchecks et suite d’intégration            |
| AC-02         | procédure manuelle `recette-intellij-v1.md` — preuve utilisateur encore requise |
| AC-03         | test E2E `tools/list` exigeant exactement `search_web` et `fetch_url`           |
| AC-04 à AC-09 | suites application, domaine, formats, contrat et E2E réel                       |
| AC-10         | tests SQLite réels, cache MISS/HIT, revalidation et stale fallback              |
| AC-11         | suites SSRF/DNS/redirections/protocoles/limites                                 |
| AC-12         | audit des dépendances et tests de configuration sans LLM/API payante            |
| AC-13         | annotations read-only, passerelle réseau et séparation stdout/stderr            |
| AC-14         | `npm run test:release` et rapports `.data/test-reports`                         |
| AC-15         | guides d’installation, configuration IntelliJ, tests et dépannage               |

Une case n’est considérée comme validée que si la commande citée réussit dans
l’environnement de recette et que sa preuve est archivée.
