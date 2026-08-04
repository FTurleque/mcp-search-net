# Tests

## Validation complète

```powershell
npm run check
```

Cette commande enchaîne typecheck, ESLint, contrôle Prettier, compilation, tests déterministes et
couverture V8 avec seuils. Elle doit réussir avant une installation ou une contribution.

Elle commence par `npm run check:runtime` et s'arrête immédiatement avec un message explicite si le runtime actif n'est pas Node.js 24. La CI exécute `npm ci` puis cette même commande sous Node 24.

## Suites de livraison

| Commande                         | Portée                                                          |    Réseau requis     |
| -------------------------------- | --------------------------------------------------------------- | :------------------: |
| `npm run check`                  | TypeScript, lint, format, build et tests déterministes          |         non          |
| `npm run test:coverage`          | Tests déterministes, rapport V8 et seuils globaux/critiques     |         non          |
| `npm run test:required`          | Tous les tests requis hors réseau, avec refus des tests ignorés |         non          |
| `npm run test:unit`              | Domaine, application et présentation                            |         non          |
| `npm run test:contract`          | Contrats SearXNG et Crawl4AI sur fixtures                       |         non          |
| `npm run test:security`          | SSRF, protocoles, redirections, limites et injection            |         non          |
| `npm run test:resilience`        | Cache et fournisseurs dégradés                                  |         non          |
| `npm run test:performance`       | Limite de 10 Mo et concurrence                                  |   local uniquement   |
| `npm run test:integration`       | Contrats fournisseurs, configuration et SQLite réel             |         non          |
| `npm run test:e2e:deterministic` | Démarrage STDIO, `tools/list`, SSRF, `stdout`/`stderr`          |         non          |
| `npm run test:e2e:live`          | Fournisseurs réels et appels MCP STDIO des deux outils          | oui, Compose démarré |
| `npm run test:e2e`               | Alias officiel de `test:e2e:live`                               | oui, Compose démarré |
| `npm run test:release`           | Toutes les suites précédentes                                   |         oui          |

Les rapports JSON sont écrits dans `.data/test-reports/` et la couverture dans `coverage/`
(`coverage-summary.json`, HTML et LCOV). Le lanceur échoue si une suite requise ne contient aucun
test, échoue ou ignore un test. `test:coverage` produit aussi `coverage.json` et refuse les tests
ignorés. Le workflow CI manuel publie ces rapports comme artefacts.

## Politique de couverture

`test:coverage` inclut tout `src/**/*.ts`, y compris les entrypoints exécutés surtout en
sous-processus. Les seuils globaux restent donc volontairement réalistes : 70 % statements, 58 %
branches, 75 % fonctions et 72 % lignes. Des seuils plus élevés s'appliquent aux frontières de
risque : politique URL/SSRF, gateway HTTP, fetcher Crawl4AI, migrations, intégrité/repository
catalogue, synchronisation, serveur MCP V2, resources catalogue et enveloppes MCP. Les tests
contractuels et E2E restent des gates séparés ; la couverture ne les remplace pas.

Pour les suites réelles :

```powershell
docker compose -f compose.yaml -f compose.hybrid.yaml up -d searxng crawl4ai
npm run test:e2e:live
```

## Distinction E2E déterministe / live

La suite E2E est scindée en deux niveaux de dépendance :

| Script                           | Réseau/Docker | Objectif                                                    |
| -------------------------------- | ------------: | ----------------------------------------------------------- |
| `npm run test:e2e:deterministic` |           Non | MCP STDIO, `tools/list`, SSRF, séparation `stdout`/`stderr` |
| `npm run test:e2e:live`          |           Oui | Intégration réelle SearXNG, Crawl4AI et cache               |
| `npm run test:e2e`               |           Oui | Alias officiel de la recette E2E live                       |

La suite déterministe valide le contrat MCP et les règles de sécurité sans
service externe. La suite live valide la chaîne complète avec SearXNG et
Crawl4AI démarrés par Docker Compose.

`test:e2e:deterministic` lance le binaire Node local sans aucun service externe. Son fichier est
inclus une seule fois dans le gate de couverture du job CI `check`; les suites déterministes ne sont
pas relancées sous plusieurs alias dans le workflow. Le workflow reste toutefois
`workflow_dispatch` uniquement pendant la
restriction de quota GitHub Actions : une absence de run n'est jamais un PASS. `test:e2e:live` et
`test:e2e` requièrent Docker Compose démarré et appartiennent au job `integration`.

Les commandes nommées restent disponibles pour la qualification locale ciblée et la preuve finale,
mais la CI consolidée exécute chaque fichier déterministe une seule fois via `test:coverage`.

## Niveaux

- domaine : classement officiel, sélection Markdown et budgets ;
- application : cas d’usage avec ports simulés, cache et erreurs ;
- infrastructure : YAML/Zod, SQLite, politique DNS/URL et clients HTTP simulés ;
- présentation : schémas MCP, résultats structurés et erreurs ;
- intégration : adaptateurs sur fixtures, configuration et SQLite réel, sans Docker ;
- E2E : SearXNG et Crawl4AI réels via Docker et client MCP STDIO officiel ;
- bout en bout : client MCP STDIO lançant le serveur compilé.

Les tests réseau réels sont exclus de la suite ordinaire afin qu’elle reste déterministe. Vérifier aussi qu’aucun log applicatif n’est écrit sur `stdout`.

La suite déterministe couvre SQLite réel (migrations, validateurs, expiration, stale, corruption, pruning et concurrence), les événements/redactions et la séparation JSON-RPC `stdout` / diagnostics `stderr`.

## Installation Windows

Le cycle automatisable est `scripts/test-installation.ps1 -NodeRuntimeSource <dossier-node-24>`. Il effectue une première installation, une réinstallation, vérifie la conservation de configuration/données, teste `-KeepData`, puis la désinstallation complète dans un profil temporaire.
