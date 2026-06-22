# Tests

## Validation complète

```powershell
npm run check
```

Cette commande enchaîne typecheck, ESLint, contrôle Prettier, compilation et Vitest. Elle doit réussir avant une installation ou une contribution.

Elle commence par `npm run check:runtime` et s'arrête immédiatement avec un message explicite si le runtime actif n'est pas Node.js 24. La CI exécute `npm ci` puis cette même commande sous Node 24.

## Suites de livraison

| Commande                   | Portée                                                          |    Réseau requis     |
| -------------------------- | --------------------------------------------------------------- | :------------------: |
| `npm run check`            | TypeScript, lint, format, build et tests déterministes          |         non          |
| `npm run test:required`    | Tous les tests requis hors réseau, avec refus des tests ignorés |         non          |
| `npm run test:unit`        | Domaine, application et présentation                            |         non          |
| `npm run test:contract`    | Contrats SearXNG et Crawl4AI sur fixtures                       |         non          |
| `npm run test:security`    | SSRF, protocoles, redirections, limites et injection            |         non          |
| `npm run test:resilience`  | Cache et fournisseurs dégradés                                  |         non          |
| `npm run test:performance` | Limite de 10 Mo et concurrence                                  |   local uniquement   |
| `npm run test:integration` | Contrats fournisseurs, configuration et SQLite réel             |         non          |
| `npm run test:e2e`         | Fournisseurs réels et appels MCP STDIO des deux outils          | oui, Compose démarré |
| `npm run test:release`     | Toutes les suites précédentes                                   |         oui          |

Les rapports JSON sont écrits dans `.data/test-reports/`. Le lanceur échoue si une
suite requise ne contient aucun test, échoue ou ignore un test. La CI publie ces
rapports comme artefacts.

Pour les suites réelles :

```powershell
docker compose up -d searxng crawl4ai
npm run test:e2e
```

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
