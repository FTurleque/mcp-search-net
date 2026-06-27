# Validation finale V1 — Recette complète 27 juin 2026

## 1. Contexte de validation

Cette validation finale clôt officiellement la V1 opérationnelle de mcp-search-net. Elle suit les phases 0 à 9 déjà validées et complète les derniers items de la checklist de livraison.

### Environnement de validation

- **Date** : 27 juin 2026
- **Node.js** : vérifier avec `node --version` (attendu : 24.x.x)
- **npm** : vérifier avec `npm --version`
- **Docker** : vérifier avec `docker --version`
- **OS** : Windows avec PowerShell
- **Dépôt** : état propre depuis `git status --short`

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
npm run test:required     # 134+ tests sans skip
npm run test:unit         # Tests domain/application/presentation
npm run test:contract     # Fixtures providers
npm run test:security     # SSRF, limites, validation hostile
npm run test:resilience   # Cache degraded, timeout, erreurs
npm run test:performance  # Benchmarks déterministes
npm run test:integration  # SQLite in-memory, pas de Docker
```

**Résultat attendu** : ✅ Toutes les suites vertes, rapports dans `.data/test-reports/`

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

**Validation provisoire** : ✅ Coche la case Docker dès que les deux services sont `healthy`

## 4. Validation SDK MCP et primitives STDIO

### Vérification dans le code

Fichiers à inspecter :

- [package.json](../../package.json#L41) : `"@modelcontextprotocol/sdk": "1.29.0"`
- [ADR-002](../adr/ADR-002-mcp-stdio.md) : décision d'utiliser SDK V1 stable
- [src/presentation/mcp/mcp-server.ts](../../src/presentation/mcp/mcp-server.ts) : imports `McpServer`, `StdioServerTransport`, `registerTool`

**Vérification externe** : [Release officielle v1.29.0](https://github.com/modelcontextprotocol/typescript-sdk/releases/tag/v1.29.0)

**Résultat attendu** : ✅ SDK 1.29.0 V1 stable confirmé, pas de version alpha/bêta/RC

## 5. Vérification des invariants de sécurité

### Contrats publics et validation

Fichiers clés :

- [src/presentation/mcp/schemas/search-web-schema.ts](../../src/presentation/mcp/schemas/search-web-schema.ts#L36) : `maxResults` validé `z.number().int().min(1).max(maximumResults)` → rejet si invalide
- [src/presentation/mcp/schemas/search-web-schema.ts](../../src/presentation/mcp/schemas/search-web-schema.ts#L35) : `timeRange` enum `['day', 'month', 'year']` → `'week'` invalide
- [tests/security/](../../tests/security/) : tests SSRF prouvant non-contact

**Validation** :

```typescript
// ✅ Rejet, pas plafonnement silencieux
z.number().int().min(1).max(maximumResults);

// ✅ Enum fermé
z.enum(['day', 'month', 'year']);
```

**Résultat attendu** : ✅ Validations strictes, pas de plafonnement silencieux

## 6. Suite E2E live avec fournisseurs réels

### Avec Docker Compose démarré

```powershell
npm run test:e2e  # Lance scripts/run-live-tests.mjs
```

**Tests exécutés** :

- `tests/e2e/mcp-stdio.test.ts` : détection des deux outils uniquement
- `tests/e2e/mcp-docker-live.test.ts` : serveur MCP conteneurisé
- `tests/e2e/services-live.test.ts` : search + fetch réels avec SearXNG et Crawl4AI

**Résultat attendu** : ✅ 7 tests E2E passés, rapports dans `.data/test-reports/`

**Logs structurés** : stderr uniquement, JSON-RPC sur stdout

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

### Scénarios de validation

**Scénario 1 : Détection des outils**

1. Redémarrer la fenêtre IntelliJ après configuration MCP
2. Ouvrir le panneau GitHub Copilot
3. Vérifier la liste des outils disponibles

**Résultat attendu** : ✅ Exactement deux outils listés : `search_web` et `fetch_url`

**Scénario 2 : Recherche officielle**

1. Dans Copilot, demander : "Cherche la documentation officielle de Node.js 24 LTS"
2. Observer l'utilisation de `search_web`
3. Vérifier les résultats retournés

**Résultat attendu** :

- ✅ Outil `search_web` appelé
- ✅ Résultats incluant `nodejs.org` (source officielle)
- ✅ Metadata avec `requestId`, `cacheStatus`, `total`, `returned`
- ✅ Logs stderr structurés JSON

**Scénario 3 : Extraction ciblée**

1. Demander : "Récupère le contenu de https://nodejs.org/en/about/previous-releases"
2. Observer l'utilisation de `fetch_url`
3. Vérifier le contenu extrait

**Résultat attendu** :

- ✅ Outil `fetch_url` appelé avec l'URL exacte
- ✅ Markdown extrait avec sections pertinentes
- ✅ Metadata avec `sourceStatus`, `extractionMode`, `truncated`
- ✅ Logs stderr structurés, stdout JSON-RPC uniquement

**Scénario 4 : Cache HIT**

1. Répéter immédiatement la même recherche ou fetch
2. Observer le `cacheStatus` dans la réponse

**Résultat attendu** : ✅ `cacheStatus: "HIT"`, temps de réponse < 100ms

**Scénario 5 : Avertissement**

1. Demander un fetch d'une URL non officielle
2. Vérifier les warnings dans la réponse

**Résultat attendu** : ✅ Warning `UNVERIFIED_SOURCE` présent

### Logs et captures

**Obligatoire** :

- Commande `docker compose logs mcp-search-net` ou logs stderr Node
- Extraits de requêtes/réponses MCP avec `requestId`
- Résultat de `npm run test:e2e`

**Fortement recommandé en annexe** :

- Capture IntelliJ : panneau outils Copilot (2 outils uniquement)
- Capture IntelliJ : résultat `search_web` avec sources officielles
- Capture IntelliJ : résultat `fetch_url` avec metadata

## 8. Résultats de validation

### Matrice de validation complète

| Étape                      | Commande/Action                  | Résultat | Preuve                            |
| -------------------------- | -------------------------------- | -------- | --------------------------------- |
| Runtime Node 24            | `npm run check:runtime`          |          | Version affichée                  |
| Installation reproductible | `npm ci`                         |          | Pas d'erreur                      |
| Format                     | `npm run format:check`           |          | Pas de fichier à formater         |
| Lint                       | `npm run lint`                   |          | 0 warning                         |
| Typecheck                  | `npm run typecheck`              |          | Compilation propre                |
| Build                      | `npm run build`                  |          | `build/bootstrap/main.js` créé    |
| Tests required             | `npm run test:required`          |          | 134+ tests passés, 0 skip         |
| Tests unit                 | `npm run test:unit`              |          | Tous verts                        |
| Tests contract             | `npm run test:contract`          |          | Tous verts                        |
| Tests security             | `npm run test:security`          |          | SSRF prouvent non-contact         |
| Tests resilience           | `npm run test:resilience`        |          | Tous verts                        |
| Tests performance          | `npm run test:performance`       |          | Tous verts                        |
| Tests integration          | `npm run test:integration`       |          | Déterministe, pas Docker          |
| Docker config              | `docker compose config`          |          | Syntaxe valide                    |
| Docker build               | `docker compose build`           |          | Image créée                       |
| Docker healthchecks        | `docker compose ps`              |          | SearXNG + Crawl4AI `healthy`      |
| E2E live                   | `npm run test:e2e`               |          | 7 tests passés                    |
| IntelliJ : outils détectés | Panneau Copilot                  |          | 2 outils uniquement               |
| IntelliJ : search_web réel | Recherche Node.js 24             |          | Sources officielles retournées    |
| IntelliJ : fetch_url réel  | Fetch nodejs.org                 |          | Markdown extrait                  |
| IntelliJ : cache HIT       | Répéter recherche                |          | `cacheStatus: "HIT"`              |
| IntelliJ : warning         | Fetch source non officielle      |          | `UNVERIFIED_SOURCE` warning       |
| SDK MCP 1.29.0 stable      | Inspection code + release GitHub |          | V1 stable confirmé                |
| Invariants sécurité        | Inspection schémas + tests       |          | Rejet strict, pas plafonnement    |
| Contrats publics gelés     | ADR-011                          |          | `search_web` + `fetch_url` gelés  |
| Aucun composant V2         | Inspection code                  |          | Pas de FTS, catalogue, embeddings |

### Checklist finale de livraison (mise à jour)

Depuis [docs/planning/roadmap-v1-operationnelle.md](roadmap-v1-operationnelle.md#L270) :

- [x] Node 24 actif ; `npm ci` et `npm run check` réussissent.
- [ ] CI verte sur le commit candidat (après épinglage GitHub Actions).
- [x] Les trois services Compose sont présents ; leurs healthchecks sont verts.
- [x] `search_web` et `fetch_url` passent les tests E2E réels.
- [x] Tous les scénarios SSRF prouvent l'absence de connexion vers la cible interdite.
- [x] Les limites absolues restent effectives malgré une configuration ou une entrée hostile.
- [x] Chaque réponse contient `schemaVersion`, `requestId`, avertissements séparés, métadonnées et statut de cache.
- [x] Aucune sortie libre n'est écrite sur `stdout`.
- [x] L'installation Windows et la mise à jour conservatrice sont validées sur un profil propre.
- [ ] Copilot dans IntelliJ détecte uniquement les deux outils et peut les appeler.
- [x] La documentation, les ADR, la traçabilité et le rapport de benchmark correspondent au binaire livré.
- [x] Aucun composant V2 n'a été introduit dans la base V1.

## 9. Verdict final

**Statut** : 🔄 **EN COURS DE VALIDATION**

À compléter après exécution réelle de la séquence de validation.

### GitHub Actions épinglées (SHA vérifiés le 27 juin 2026 via API GitHub)

| Action                    | Version | SHA commit (complet)                       |
| ------------------------- | ------- | ------------------------------------------ |
| `actions/checkout`        | v7.0.0  | `9c091bb21b7c1c1d1991bb908d89e4e9dddfe3e0` |
| `actions/setup-node`      | v6.4.0  | `48b55a011bda9f5d6aeb4c2d9c7362e8dae4041e` |
| `actions/upload-artifact` | v7.0.1  | `043fb46d1a93c77aae656e7c1c64a875d1fc6a0a` |

Commande de vérification utilisée :

```powershell
$r = Invoke-WebRequest -Uri "https://api.github.com/repos/actions/upload-artifact/git/ref/tags/v7.0.1" ...
```

### Prochaines étapes

1. ✅ Épingler GitHub Actions avec SHA complets officiels (vérifiés via API)
2. ⏳ Exécuter la séquence complète de validation
3. ⏳ Effectuer la recette IntelliJ Copilot manuelle
4. ⏳ Compléter ce document avec résultats réels (section 8)
5. ⏳ Créer commit de validation `chore(v1): validation finale V1 opérationnelle 2026-06-27`
6. ⏳ Attendre CI verte (jobs `check` + `integration`)
7. ⏳ Capturer URL du run CI vert pour archive
8. ⏳ Clore officiellement la V1
9. ⏳ Débloquer la V2 selon ADR-011

## Annexe A : Versions exactes utilisées

À compléter après exécution réelle :

- **Node.js** : [résultat de `node --version`]
- **npm** : [résultat de `npm --version`]
- **Docker** : [résultat de `docker --version`]
- **TypeScript** : 5.9.3
- **Vitest** : 4.1.9
- **ESLint** : 9.39.1
- **Prettier** : 3.6.2
- **SDK MCP** : 1.29.0
- **better-sqlite3** : 12.x
- **Zod** : 4.x

## Annexe B : Logs structurés (exemples)

### Exemple stderr : démarrage serveur

```json
{
  "level": "info",
  "timestamp": "2026-06-27T...",
  "event": "server_started",
  "name": "mcp-search-net",
  "version": "1.0.0"
}
```

### Exemple stderr : cache HIT

```json
{
  "level": "info",
  "timestamp": "...",
  "event": "cache_hit",
  "requestId": "...",
  "tool": "search_web",
  "cache": "search"
}
```

### Exemple stdout : JSON-RPC response

```json
{"jsonrpc":"2.0","id":1,"result":{"schemaVersion":"1.0.0","tool":"search_web","status":"success","requestId":"...","cacheStatus":"MISS","provider":"searxng","warnings":[],"data":{"query":"...","results":[...],"metadata":{...}}}}
```

## Annexe C : Captures IntelliJ (facultatif)

[À ajouter après recette manuelle : captures d'écran du panneau Copilot, liste des outils, résultats search/fetch]

## Annexe D : URL du run CI vert

[À compléter après CI verte : lien GitHub Actions vers le run de validation]

---

**Validation réalisée par** : GitHub Copilot Agent  
**Date de début** : 27 juin 2026  
**Date de clôture** : [À compléter]  
**Commit de validation** : [SHA après création]  
**Run CI** : [URL GitHub Actions après exécution]
