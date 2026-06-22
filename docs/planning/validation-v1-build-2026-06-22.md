# Validation V1 après alignement du build — 22 juin 2026

## 1. Baseline initiale

| Commande                | Résultat initial                                                    |
| ----------------------- | ------------------------------------------------------------------- |
| `node --version`        | `v24.14.0` avec le runtime Node 24 de la session                    |
| `npm --version`         | `11.9.0`                                                            |
| `npm ci`                | succès                                                              |
| `npm run build`         | succès, mais sortie initiale dans `dist/` et sans nettoyage intégré |
| `npm test`              | 139 tests réussis                                                   |
| `docker compose config` | succès avant modification du chemin de build                        |

La pièce jointe décrivait un dépôt sans lockfile, serveur, outils, cache, Docker, tests ni CI. Ces constats étaient obsolètes dans le worktree réel. Les écarts confirmés étaient : sortie `dist/` au lieu de `build/`, absence de `noEmitOnError: true`, nettoyage non intégré au build et propriété supplémentaire sur `CacheRepository`.

## 2. Fichiers créés

| Fichier                                           | Rôle                                                                 |
| ------------------------------------------------- | -------------------------------------------------------------------- |
| `docs/architecture.md`                            | point d'entrée stable vers la documentation d'architecture organisée |
| `docs/security.md`                                | point d'entrée stable vers la documentation de sécurité organisée    |
| `docs/planning/validation-v1-build-2026-06-22.md` | rapport de cette stabilisation                                       |

## 3. Fichiers modifiés

| Fichier ou groupe                                    | Modification                                                                    |
| ---------------------------------------------------- | ------------------------------------------------------------------------------- |
| `package.json`, `package-lock.json`                  | ajout exact de `rimraf` 6.1.3, build précédé du nettoyage, chemins `build/`     |
| `tsconfig.json`, `tsconfig.build.json`               | `noEmitOnError: true`, sortie `build/`                                          |
| `Dockerfile`, `.dockerignore`, `.gitignore`, ESLint  | migration cohérente de `dist/` vers `build/`                                    |
| scripts d'installation, lanceur Windows et benchmark | utilisation de `build/bootstrap/main.js`                                        |
| tests E2E                                            | lancement du serveur compilé depuis `build/`                                    |
| `CacheRepository` et implémentations                 | exactement six opérations ; les écritures retournent leur disponibilité         |
| `ContentFetcher`                                     | `ContentFetchRequest` limité aux cinq champs imposés, contexte technique séparé |
| erreurs/bootstrap/use cases                          | erreurs métier typées et statut de cache sans propriété supplémentaire          |
| README, ADR-001 et documentation d'exploitation      | nouveau chemin de build et garantie sans émission partielle                     |

Le script devenu inutile `scripts/clean.mjs` a été supprimé.

## 4. Versions retenues

| Composant                    | Version exacte | Justification                                               |
| ---------------------------- | -------------: | ----------------------------------------------------------- |
| Node.js cible                |    24.17.0 LTS | `.nvmrc`, `.node-version`, Docker et installateur alignés   |
| Node.js de validation locale |        24.14.0 | même ligne LTS majeure supportée                            |
| TypeScript                   |          5.9.3 | stable, NodeNext, sans migration cassante vers TypeScript 6 |
| SDK MCP                      |         1.29.0 | V1 stable exacte avec STDIO et `structuredContent`          |
| `@types/node`                |        24.13.2 | aligné sur Node 24                                          |
| rimraf                       |          6.1.3 | stable, compatible Node 24, nettoyage multiplateforme       |
| Vitest                       |          4.1.9 | suites déterministes et live existantes                     |

## 5. Validations finales

| Commande                                                                    | Résultat final                                                                                                         |
| --------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `npm ci`                                                                    | succès, 286 paquets installés depuis le lockfile                                                                       |
| `npm run format:check`                                                      | succès                                                                                                                 |
| `npm run lint`                                                              | succès, 0 warning                                                                                                      |
| `npm run build`                                                             | succès ; `rimraf build dist`, puis compilation dans `build/`                                                           |
| contrôle artefact                                                           | `build/bootstrap/main.js` présent, ancien `dist/` absent                                                               |
| contrôle configuration                                                      | `noEmitOnError: true` et `outDir: build` confirmés                                                                     |
| `npm run test:unit`                                                         | 62 réussis, 0 ignoré                                                                                                   |
| `npm run test:integration`                                                  | 29 réussis, 0 ignoré                                                                                                   |
| `npm test`                                                                  | 139 réussis sur 21 fichiers                                                                                            |
| `npm run check`                                                             | succès                                                                                                                 |
| `npm run test:required`                                                     | 139 réussis, 0 ignoré                                                                                                  |
| `npm run test:contract`                                                     | 6 réussis, 0 ignoré                                                                                                    |
| `npm run test:security`                                                     | 61 réussis, 0 ignoré                                                                                                   |
| `npm run test:resilience`                                                   | 25 réussis, 0 ignoré                                                                                                   |
| `npm run test:performance`                                                  | 2 réussis, 0 ignoré                                                                                                    |
| cycle d'installation Windows                                                | `INSTALLATION_LIFECYCLE_VALID` avec le dossier `build/`                                                                |
| recherche de sorties stdout parasites                                       | aucune occurrence dans `src`                                                                                           |
| `docker compose config && docker compose build`                             | **non exécuté** : refus préalable de la plateforme Codex pour quota d'approbation épuisé jusqu'au 23 juin 2026 à 00:19 |
| `docker compose up`, smoke tests, `npm run test:e2e`, `docker compose down` | non rejoués sur l'artefact `build/` à cause du même blocage externe                                                    |

## 6. Tests fonctionnels

| Scénario           | Résultat                                                                         |
| ------------------ | -------------------------------------------------------------------------------- |
| `tools/list`       | réussi via le client MCP déterministe ; exactement deux outils                   |
| `search_web`       | use case, mapping et contrat MCP réussis avec doubles déterministes              |
| politique `strict` | succès vide et `NO_VERIFIED_OFFICIAL_SOURCE` validés                             |
| domaine autorisé   | filtrage validé sans promotion en source officielle                              |
| domaine exclu      | priorité de l'exclusion validée                                                  |
| `fetch_url`        | extraction, sélection, cache et enveloppe MCP validés avec doubles déterministes |
| URL privée         | blocage SSRF validé dans la suite sécurité                                       |
| redirection privée | revalidation et blocage validés                                                  |
| cache HIT          | validé avec SQLite réel et use cases                                             |
| cache MISS         | validé avec SQLite réel et use cases                                             |
| Docker             | image actuelle non reconstruite après migration vers `build/`                    |

## 7. Limites restantes

1. La plateforme a refusé avant exécution l'autorisation de reconstruire et démarrer Docker, car le quota d'usage était épuisé. Aucun contournement n'a été tenté.
2. En conséquence, les smoke tests SearXNG/Crawl4AI et l'E2E live ne sont pas validés sur le nouvel artefact `build/`, même s'ils avaient réussi avant cette migration de chemin.
3. Le paquet transitif `prebuild-install@7.1.3` reste déprécié ; les installations signalent néanmoins 0 vulnérabilité.

## 8. Verdict V1

```text
V1 OPÉRATIONNELLE AVEC RÉSERVES
```

Le serveur compilé, les contrats, SQLite, la sécurité, les tests déterministes et l'installation Windows sont validés. La réserve porte uniquement sur la reconstruction Docker et l'E2E live après migration de `dist/` vers `build/`.

## 9. Décision V2

```text
V2 BUILD NO-GO
```

La mission interdit `V2 BUILD GO` si Docker ou MCP STDIO E2E ne sont pas validés. Il faut relancer, après disponibilité du quota :

```bash
docker compose config
docker compose build
docker compose up -d searxng crawl4ai
docker compose ps
npm run test:e2e
docker compose down
```

Aucune fonctionnalité V2 n'a été commencée.
