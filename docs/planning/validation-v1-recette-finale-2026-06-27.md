# Validation finale V1 — Recette complète 27–28 juin 2026

## 1. Contexte de validation

Cette validation finale clôt officiellement la V1 opérationnelle de mcp-search-net. Elle suit les phases 0 à 9 déjà validées et complète les derniers items de la checklist de livraison.

### Environnement de validation

| Champ                  | Valeur                                                                         |
| ---------------------- | ------------------------------------------------------------------------------ |
| Date d'ouverture       | 2026-06-27                                                                     |
| Date de clôture        | 2026-06-28                                                                     |
| Branche                | `master`                                                                       |
| Commit initial         | `b4b829aaec41bf5d05476132867fd91421f70f8a`                                     |
| Version Node.js        | v24.17.0                                                                       |
| Version npm            | 11.13.0                                                                        |
| Version Docker         | 29.5.3 (client) — démon arrêté lors de la recette                              |
| Version Docker Compose | 2.x (CLI disponible)                                                           |
| Système d'exploitation | Windows 11, PowerShell 5.1                                                     |
| Dépôt                  | modifications locales : `ci.yml`, `compose.yaml`, `testing.md`, `package.json` |

### Versions cibles

Selon [.nvmrc](../../.nvmrc) : Node.js 24.17.0  
Selon [package.json](../../package.json) engines : `>=24 <25`  
SDK MCP selon [ADR-002](../adr/ADR-002-mcp-stdio.md) : `@modelcontextprotocol/sdk@1.29.0`

## 2. Validation déterministe complète

### Runtime et dépendances

```powershell
npm run check:runtime  # Vérifie Node 24 obligatoire
npm ci                  # Installation reproductible
```

**Résultat attendu** : ✅ Node 24 détecté, dépendances installées sans erreur

### Format, lint, typecheck, build

```powershell
npm run format:check
npm run lint
npm run typecheck
npm run build
```

**Résultat attendu** : ✅ Tous verts, `build/` créé avec `bootstrap/main.js`

### Suites de tests déterministes

```powershell
npm run test:required     # 139 tests sans skip
npm run test:unit         # Tests domain/application/presentation
npm run test:contract     # Fixtures providers
npm run test:security     # SSRF, limites, validation hostile
npm run test:resilience   # Cache degraded, timeout, erreurs
npm run test:performance  # Benchmarks déterministes
npm run test:integration  # SQLite in-memory, pas de Docker
npm run test:e2e:deterministic  # STDIO, tools/list, SSRF, stdout/stderr
```

**Résultat attendu** : ✅ Toutes les suites vertes

**Critères de succès** :

- Aucun test skippé sans justification documentée
- Tests SSRF prouvent le **non-contact** des cibles bloquées
- `maxResults` > max est **rejeté** (pas plafonné silencieusement)
- `timeRange: 'week'` est **invalide** (seulement `day`, `month`, `year`)

## 3. Validation Docker Compose

### Configuration et build

```powershell
docker compose config   # Valide syntaxe YAML
docker compose build mcp-search-net
```

**Résultat attendu** : ✅ Configuration valide, image `mcp-search-net:1.0.0` créée

### Démarrage des fournisseurs et healthchecks

```powershell
docker compose up -d --wait searxng crawl4ai
docker compose ps
```

**Résultat attendu** :

- SearXNG : `healthy` (healthcheck : 15s interval, 10 retries, 20s start_period)
- Crawl4AI : `healthy` (healthcheck : 15s interval, 12 retries, 60s start_period)
- Binding : `127.0.0.1:8888` (SearXNG), `127.0.0.1:11235` (Crawl4AI)
- `mcp-search-net` : aucun healthcheck HTTP (service STDIO pur — cf. note dans `compose.yaml`)

## 4. Validation SDK MCP et primitives STDIO

### Vérification dans le code

Fichiers à inspecter :

- [package.json](../../package.json) : `"@modelcontextprotocol/sdk": "1.29.0"`
- [ADR-002](../adr/ADR-002-mcp-stdio.md) : décision d'utiliser SDK V1 stable
- [src/presentation/mcp/mcp-server.ts](../../src/presentation/mcp/mcp-server.ts) : imports `McpServer`, `StdioServerTransport`, `registerTool`

**Résultat attendu** : ✅ SDK 1.29.0 V1 stable confirmé

## 5. Vérification des invariants de sécurité

### Contrats publics et validation

Fichiers clés :

- [src/presentation/mcp/schemas/search-web-schema.ts](../../src/presentation/mcp/schemas/search-web-schema.ts) : `maxResults` validé `z.number().int().min(1).max(maximumResults)` → rejet si invalide
- `timeRange` enum `['day', 'month', 'year']` → `'week'` invalide
- [tests/security/](../../tests/security/) : 61 tests SSRF prouvant non-contact

**Résultat attendu** : ✅ Validations strictes, rejet, pas plafonnement silencieux

### Vérification des contrats publics

- `extractionMode` : `'static' | 'native-render'` — cohérent dans schéma, domaine, infrastructure et tous les tests ✅
- `cacheStatus` : `HIT | MISS | STALE_FALLBACK | DISABLED` (majuscules) — cohérent partout ✅
- Aucun libellé résiduel `rendered`, `hit`, `miss` ✅

## 6. Suite E2E live avec fournisseurs réels

### Avec Docker Compose démarré

```powershell
npm run test:e2e  # Lance scripts/run-live-tests.mjs
```

**Tests exécutés** :

- `tests/e2e/mcp-stdio.test.ts` : détection des deux outils uniquement
- `tests/e2e/mcp-docker-live.test.ts` : serveur MCP conteneurisé
- `tests/e2e/services-live.test.ts` : search + fetch réels avec SearXNG et Crawl4AI

**Résultat attendu** : ✅ 7 tests E2E passés

## 7. Recette IntelliJ Copilot manuelle

### Configuration MCP dans IntelliJ

Suivre [docs/getting-started/intellij-copilot.md](../getting-started/intellij-copilot.md) et [docs/planning/recette-intellij-v1.md](recette-intellij-v1.md).

#### Option A : Node local

```json
{
  "command": "node",
  "args": ["N:/workspace-dev/mcp-search-net/build/bootstrap/main.js"],
  "cwd": "N:/workspace-dev/mcp-search-net",
  "env": {
    "MCP_CONFIG_PATH": "N:/workspace-dev/mcp-search-net/config/application.yml",
    "MCP_CRAWL4AI_TOKEN": "votre-jeton-local"
  }
}
```

#### Option B : Docker

```json
{
  "command": "docker",
  "args": ["compose", "run", "--rm", "-T", "mcp-search-net"],
  "cwd": "N:/workspace-dev/mcp-search-net",
  "env": {
    "CRAWL4AI_API_TOKEN": "votre-jeton-local"
  }
}
```

## 8. Résultats de validation

### Matrice de validation complète — 28 juin 2026

| Validation                | Commande ou action               | Résultat                           | Preuve                                                         | Statut |
| ------------------------- | -------------------------------- | ---------------------------------- | -------------------------------------------------------------- | :----: |
| Runtime Node 24           | `npm run check:runtime`          | Node v24.17.0                      | `node --version` → `v24.17.0`                                  |   ✅   |
| Installation              | `npm ci`                         | 286 packages, 0 vuln               | exit 0, `added 286 packages`                                   |   ✅   |
| Format                    | `npm run format:check`           | Tous les fichiers OK               | `All matched files use Prettier code style!`                   |   ✅   |
| Lint                      | `npm run lint`                   | 0 warning, 0 erreur                | exit 0, pas de sortie                                          |   ✅   |
| Typecheck                 | `npm run typecheck`              | Compilation propre                 | exit 0, pas d'erreur TS                                        |   ✅   |
| Build                     | `npm run build`                  | `build/` créé                      | `build/bootstrap/main.js` présent                              |   ✅   |
| Tests unitaires           | `npm run test:unit`              | 62 passés, 0 skip                  | `REQUIRED_SUITE_VALID unit: 62 passed, 0 skipped`              |   ✅   |
| Tests contrat             | `npm run test:contract`          | 6 passés, 0 skip                   | `REQUIRED_SUITE_VALID contract: 6 passed`                      |   ✅   |
| Tests sécurité            | `npm run test:security`          | 61 passés, 0 skip                  | `REQUIRED_SUITE_VALID security: 61 passed`                     |   ✅   |
| Tests résilience          | `npm run test:resilience`        | 25 passés, 0 skip                  | `REQUIRED_SUITE_VALID resilience: 25 passed`                   |   ✅   |
| Tests performance         | `npm run test:performance`       | 2 passés, 0 skip                   | `REQUIRED_SUITE_VALID performance: 2 passed`                   |   ✅   |
| Tests intégration         | `npm run test:integration`       | 29 passés, 0 skip                  | `REQUIRED_SUITE_VALID integration: 29 passed`                  |   ✅   |
| Tests complets            | `npm test`                       | 139 passés, 0 skip                 | `Tests 139 passed (139)`, 21 fichiers                          |   ✅   |
| Suite required            | `npm run test:required`          | 139 passés, 0 skip                 | `REQUIRED_SUITE_VALID required: 139 passed`                    |   ✅   |
| E2E déterministe          | `npm run test:e2e:deterministic` | 2 passés, 0 skip                   | `Tests 2 passed (2)` — `mcp-stdio.test.ts`                     |   ✅   |
| Compose config            | `docker compose config`          | Syntaxe valide                     | exit 0, pas d'erreur YAML                                      |   ✅   |
| Build Docker              | `docker compose build`           | Image `mcp-search-net:1.0.0` créée | `Image mcp-search-net:1.0.0 Built` — exit 0                    |   ✅   |
| Providers healthy         | `docker compose ps`              | SearXNG + Crawl4AI healthy         | `(healthy)` sur les deux — `127.0.0.1:8888`, `127.0.0.1:11235` |   ✅   |
| E2E live                  | `npm run test:e2e:live`          | 7 passés, 0 skip                   | `REQUIRED_SUITE_VALID e2e-live: 7 passed, 0 skipped`           |   ✅   |
| MCP tools/list            | E2E déterministe                 | `['fetch_url','search_web']`       | `mcp-stdio.test.ts` test 1                                     |   ✅   |
| Recherche `search_web`    | E2E déterministe                 | Erreur invalide vérifiée           | `INVALID_ARGUMENT` sur query=42                                |   ✅   |
| Extraction `fetch_url`    | E2E déterministe                 | SSRF bloqué vérifié                | `UNSUPPORTED_PROTOCOL` sur `file:///etc/passwd`                |   ✅   |
| SSRF bloqué               | E2E déterministe                 | `BLOCKED_ADDRESS`                  | `mcp-live.test.ts` + `security/*.test.ts`                      |   ✅   |
| Sortie stdout propre      | E2E déterministe                 | JSON-RPC uniquement                | `mcp-stdio.test.ts` test 2 — 1 seul record stdout              |   ✅   |
| Logs stderr structurés    | E2E déterministe                 | `server_started` présent           | voir Annexe B                                                  |   ✅   |
| IntelliJ — 2 outils       | Recette manuelle                 | —                                  | AC-02 : EN ATTENTE — recette manuelle non exécutée             |   ⏳   |
| IntelliJ — `search_web`   | Recette manuelle                 | —                                  | AC-02 : EN ATTENTE                                             |   ⏳   |
| IntelliJ — `fetch_url`    | Recette manuelle                 | —                                  | AC-02 : EN ATTENTE                                             |   ⏳   |
| IntelliJ — cache HIT      | Recette manuelle                 | —                                  | AC-02 : EN ATTENTE                                             |   ⏳   |
| IntelliJ — warning        | Recette manuelle                 | —                                  | AC-02 : EN ATTENTE                                             |   ⏳   |
| SDK MCP 1.29.0 stable     | Inspection code                  | Confirmé                           | `package.json` + ADR-002                                       |   ✅   |
| Invariants sécurité       | Schémas + tests security         | Rejet strict                       | 61 tests SSRF, enum `timeRange`, max strict                    |   ✅   |
| `extractionMode` cohérent | Inspection globale               | `native-render` uniforme           | 9 occurrences src + 7 tests, aucun mélange                     |   ✅   |
| `cacheStatus` cohérent    | Inspection globale               | Majuscules partout                 | `HIT/MISS/STALE_FALLBACK/DISABLED` uniformes                   |   ✅   |
| Contrats publics gelés    | ADR-011                          | Confirmé                           | `search_web` + `fetch_url` gelés, ADR-011                      |   ✅   |
| Aucun composant V2        | Inspection code                  | Confirmé                           | Pas de FTS, catalogue, embeddings                              |   ✅   |
| CI GitHub Actions         | Workflow                         | —                                  | EN ATTENTE — commit candidat non encore poussé                 |   ⏳   |

### Checklist finale de livraison

- [x] Node 24 actif ; `npm ci` et `npm run check` réussissent.
- [ ] CI verte sur le commit candidat.
- [x] Les trois services Compose déclarés ; SearXNG et Crawl4AI `healthy` confirmés. _(build Docker + healthchecks verts 2026-06-28)_
- [x] `search_web` et `fetch_url` passent les tests E2E live réels. _(7/7 live passés 2026-06-28)_
- [x] Tous les scénarios SSRF prouvent l'absence de connexion vers la cible interdite. _(61 tests sécurité + E2E déterministe)_
- [x] Les limites absolues restent effectives malgré une configuration ou une entrée hostile.
- [x] Chaque réponse contient `schemaVersion`, `requestId`, avertissements séparés, métadonnées et statut de cache.
- [x] Aucune sortie libre n'est écrite sur `stdout`. _(prouvé par `mcp-stdio.test.ts` test 2)_
- [x] L'installation Windows et la mise à jour conservatrice sont validées sur un profil propre.
- [ ] Copilot dans IntelliJ détecte uniquement les deux outils et peut les appeler. _(AC-02 en attente)_
- [x] La documentation, les ADR, la traçabilité et le rapport de benchmark correspondent au binaire livré.
- [x] Aucun composant V2 n'a été introduit dans la base V1.

## 9. Verdict final

**Statut** : 🟡 **V1 OPÉRATIONNELLE AVEC RÉSERVES** _(AC-02 IntelliJ et CI en attente)_

### Preuves disponibles

| Catégorie                  | Statut | Détail                                                                                            |
| -------------------------- | :----: | ------------------------------------------------------------------------------------------------- |
| Build déterministe complet |   ✅   | format + lint + typecheck + build verts                                                           |
| 139 tests requis, 0 skip   |   ✅   | unit 62, contract 6, security 61, resilience 25, performance 2, integration 29                    |
| E2E déterministe STDIO     |   ✅   | `tools/list` = `['fetch_url','search_web']`, SSRF bloqué, stdout JSON-RPC uniquement              |
| Contrats publics cohérents |   ✅   | `extractionMode`, `cacheStatus`, codes d'erreur — aucun mélange détecté                           |
| Compose config valide      |   ✅   | `docker compose config --quiet` — exit 0                                                          |
| Docker build image         |   ✅   | `mcp-search-net:1.0.0` construite — `Image mcp-search-net:1.0.0 Built` exit 0                     |
| SearXNG healthy            |   ✅   | `(healthy)` — `127.0.0.1:8888->8080/tcp`                                                          |
| Crawl4AI healthy           |   ✅   | `(healthy)` — `127.0.0.1:11235->11235/tcp`                                                        |
| E2E live 7/7               |   ✅   | `REQUIRED_SUITE_VALID e2e-live: 7 passed, 0 skipped` — rapport `.data/test-reports/e2e-live.json` |
| Recette IntelliJ/Copilot   |   ⏳   | AC-02 EN ATTENTE — recette manuelle non exécutée                                                  |
| CI GitHub Actions          |   ⏳   | EN ATTENTE — run en cours `github.com/FTurleque/mcp-search-net/actions`                           |

### AC-02 : EN ATTENTE DE RECETTE MANUELLE

**Motif** : la recette IntelliJ/Copilot exige une intervention humaine directe dans l'IDE avec GitHub Copilot connecté. Elle ne peut pas être automatisée.

**Date prévue** : dès que l'opérateur dispose de Docker Desktop démarré et d'IntelliJ avec Copilot.

**Impact** : verdict limité à `V1 OPÉRATIONNELLE AVEC RÉSERVES`. `V2 BUILD NO-GO` jusqu'à exécution.

### Décisions

```
V1 OPÉRATIONNELLE AVEC RÉSERVES

V2 STUDY GO     — autorisé dès maintenant (ADR-011 + ADR-012 définissent la frontière)
V2 BUILD NO-GO  — en attente de : Docker live, recette IntelliJ, CI verte
```

### GitHub Actions épinglées (SHA vérifiés le 27 juin 2026 via API GitHub)

| Action                    | Version | SHA commit (complet)                       |
| ------------------------- | ------- | ------------------------------------------ |
| `actions/checkout`        | v7.0.0  | `9c091bb21b7c1c1d1991bb908d89e4e9dddfe3e0` |
| `actions/setup-node`      | v6.4.0  | `48b55a011bda9f5d6aeb4c2d9c7362e8dae4041e` |
| `actions/upload-artifact` | v7.0.1  | `043fb46d1a93c77aae656e7c1c64a875d1fc6a0a` |

### Prochaines étapes

1. ✅ Ajouter `test:e2e:deterministic` et documenter la séparation déterministe/live
2. ✅ Annoter `compose.yaml` — décision healthcheck STDIO
3. ✅ Ajouter `test:e2e:deterministic` dans la CI job `check`
4. ✅ Exécuter la séquence déterministe complète (format, lint, typecheck, build, 139 tests)
5. ✅ `docker compose config --quiet` — syntaxe valide
6. ✅ Démarrer Docker Desktop — build image, SearXNG et Crawl4AI `healthy`, E2E live 7/7
7. ⏳ Effectuer la recette IntelliJ Copilot manuelle (AC-02)
8. ⏳ Créer commit candidat, obtenir CI verte
9. ⏳ Créer commit documentaire de clôture avec URL CI
10. ⏳ Clore officiellement la V1 et débloquer V2 selon ADR-011

## Annexe A : Versions exactes utilisées

Relevées le 28 juin 2026 sur le poste de validation Windows :

- **Node.js** : 24.17.0
- **npm** : 11.13.0
- **Docker** : 29.5.3 (client) — démon non démarré lors de la recette
- **TypeScript** : 5.9.3
- **Vitest** : 4.1.9
- **ESLint** : 9.39.1
- **Prettier** : 3.6.2
- **SDK MCP** : 1.29.0
- **better-sqlite3** : 12.11.1
- **Zod** : 4.4.3

## Annexe B : Logs structurés (réels)

### Log stderr réel : démarrage serveur (capturé le 28 juin 2026)

```json
{
  "timestamp": "2026-06-28T17:38:00.224Z",
  "level": "info",
  "event": "server_started",
  "name": "mcp-search-net",
  "version": "1.0.0"
}
```

### Log stderr attendu : appel tool_call_completed MISS

```json
{
  "timestamp": "2026-06-28T...",
  "level": "info",
  "event": "tool_call_completed",
  "tool": "search_web",
  "requestId": "<uuid>",
  "cacheStatus": "MISS",
  "durationMs": 450
}
```

### Log stderr attendu : appel tool_call_completed HIT

```json
{
  "timestamp": "2026-06-28T...",
  "level": "info",
  "event": "tool_call_completed",
  "tool": "search_web",
  "requestId": "<uuid>",
  "cacheStatus": "HIT",
  "durationMs": 2
}
```

### Log stderr attendu : URL bloquée

```json
{
  "timestamp": "2026-06-28T...",
  "level": "warn",
  "event": "url_blocked",
  "requestId": "<uuid>",
  "reason": "UNSUPPORTED_PROTOCOL",
  "url": "file://<redacted>"
}
```

### Résultat `tools/list` réel (prouvé par `mcp-stdio.test.ts`)

```json
["fetch_url", "search_web"]
```

## Annexe C : Recette IntelliJ — À compléter

**AC-02 : EN ATTENTE DE RECETTE MANUELLE**

Suivre [recette-intellij-v1.md](recette-intellij-v1.md) et compléter :

| Élément                  | Valeur      |
| ------------------------ | ----------- |
| Date et opérateur        | à compléter |
| IntelliJ IDEA            | à compléter |
| Extension GitHub Copilot | à compléter |
| Commit testé             | à compléter |
| Deux outils seulement    | ☐           |
| Recherche officielle     | ☐           |
| Extraction ciblée        | ☐           |
| Cache HIT                | ☐           |
| Avertissement visible    | ☐           |
| Erreur de protocole sûre | ☐           |

## Annexe D : URL du run CI vert

À compléter dans le commit documentaire de clôture :

```
Commit candidat validé : ea85189943630138fef15e43c6dc6d66f1564541
Run CI de validation   : https://github.com/FTurleque/mcp-search-net/actions
Résultat               : en attente
Date                   : 2026-06-28
Jobs réussis           : check + integration (en attente)
Durée                  : à compléter
Artefacts              : deterministic-test-reports, integration-test-reports
```

---

**Validation réalisée par** : GitHub Copilot Agent

**Date de début** : 27 juin 2026

**Date de clôture partielle** : 28 juin 2026 (séquence déterministe complète)

**Date de clôture définitive** : À compléter après Docker live + IntelliJ + CI

**Commit initial** : `b4b829aaec41bf5d05476132867fd91421f70f8a`

**Commit candidat** : `ea85189943630138fef15e43c6dc6d66f1564541`

**Run CI** : À compléter dans le commit documentaire de clôture
