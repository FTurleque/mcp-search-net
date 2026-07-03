# Validation finale V1 — Recette complète 27–29 juin 2026

## 1. Contexte de validation

Cette validation finale clôt officiellement la V1 opérationnelle de mcp-search-net. Elle suit les phases 0 à 9 déjà validées et complète les derniers items de la checklist de livraison.

### Environnement de validation

| Champ                  | Valeur                                                                      |
| ---------------------- | --------------------------------------------------------------------------- |
| Date d'ouverture       | 2026-06-27                                                                  |
| Date de clôture        | 2026-07-03 — automatisable, CI finale et lancement IntelliJ validés         |
| Branche                | `master`                                                                    |
| Commit initial         | `b4b829aaec41bf5d05476132867fd91421f70f8a`                                  |
| Version Node.js        | v24.17.0                                                                    |
| Version npm            | 11.13.0                                                                     |
| Version Docker         | 29.5.3 (client/server) — Docker Desktop disponible                          |
| Version Docker Compose | v5.1.4                                                                      |
| Système d'exploitation | Windows 11, PowerShell 5.1                                                  |
| Dépôt                  | modifications locales contrôlées ; `mcp-search-net.iml` non suivi préexistant |

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

### Recette opérationnelle exécutée le 29 juin 2026

| Validation        | Commande ou action               | Résultat                                               |                  Durée | Preuve                                                                                         | Statut     |
| ----------------- | -------------------------------- | ------------------------------------------------------ | ---------------------: | ---------------------------------------------------------------------------------------------- | ---------- |
| Installation      | `npm ci`                         | exit 0 ; 286 packages audités ; 0 vulnérabilité        |                  4.8 s | `added 286 packages` ; warning utile `prebuild-install@7.1.3` déprécié                         | OK         |
| Format            | `npm run format:check`           | exit 0                                                 |                  2.7 s | `All matched files use Prettier code style!`                                                   | OK         |
| Lint              | `npm run lint`                   | exit 0 ; 0 warning                                     |                  6.2 s | ESLint terminé sans sortie d'erreur                                                            | OK         |
| Build             | `npm run build`                  | exit 0                                                 |                  3.1 s | `rimraf build dist` puis `tsc -p tsconfig.build.json`                                          | OK         |
| Tests unitaires   | `npm run test:unit`              | exit 0 ; 62 tests ; 19 suites                          |                  1.8 s | `REQUIRED_SUITE_VALID unit: 62 passed, 0 skipped`                                              | OK         |
| Tests intégration | `npm run test:integration`       | exit 0 ; 29 tests ; 10 suites                          |                  1.9 s | `REQUIRED_SUITE_VALID integration: 29 passed, 0 skipped`                                       | OK         |
| Tests globaux     | `npm test`                       | exit 0 ; 139 tests ; 21 fichiers                       |                  2.9 s | `Test Files 21 passed (21)` ; `Tests 139 passed (139)`                                         | OK         |
| E2E déterministe  | `npm run test:e2e:deterministic` | exit 0 ; 2 tests ; 1 fichier                           |                  2.4 s | STDIO, `tools/list`, erreurs stables, SSRF locale, séparation `stdout`/`stderr`                | OK         |
| Compose           | `docker compose config`          | exit 0                                                 |                  0.4 s | configuration Compose rendue sans erreur ; aucun healthcheck HTTP MCP                          | OK         |
| Image MCP         | `docker compose build`           | exit 0                                                 |                  1.9 s | `Image mcp-search-net:1.0.0 Built`                                                             | OK         |
| Providers         | `docker compose ps`              | SearXNG healthy ; Crawl4AI healthy                     |                  0.4 s | `Up ... (healthy)` sur les deux services ; ports `127.0.0.1:8888` et `127.0.0.1:11235`         | OK         |
| E2E live          | `npm run test:e2e:live`          | exit 0 ; 7 tests ; 8 suites                            |                  5.1 s | `REQUIRED_SUITE_VALID e2e-live: 7 passed, 0 skipped`                                           | OK         |
| Alias E2E         | `npm run test:e2e`               | exit 0 ; 7 tests ; 8 suites                            |                  4.5 s | alias public vers la recette live ; `REQUIRED_SUITE_VALID e2e-live`                            | OK         |
| Outils MCP        | `tools/list`                     | exactement 2 outils                                    | inclus dans preuve MCP | `['fetch_url','search_web']`                                                                   | OK         |
| Recherche         | `search_web`                     | réponse structurée valide ; statut `partial`           | inclus dans preuve MCP | requête `Example Domain`, 5 résultats, URL `https://www.iana.org/help/example-domains`         | OK         |
| Extraction        | `fetch_url`                      | réponse structurée valide                              | inclus dans preuve MCP | titre `Example Domains`, `contentType: text/html`, `extractionMode: static`, 3 sections        | OK         |
| Cache             | `MISS` puis `HIT`                | prouvé sur deux appels identiques                      | inclus dans preuve MCP | `firstCall: MISS`, `secondCall: HIT`                                                           | OK         |
| SSRF              | URL locale bloquée               | erreur contrôlée                                       | inclus dans preuve MCP | `http://127.0.0.1` -> `BLOCKED_ADDRESS`, `providerCallsForRequest: 0`, log `url_blocked`       | OK         |
| IntelliJ          | lancement manuel Windows + UI Copilot | `mcp-search-net` Running, deux outils visibles et cochés | commandes manuelles + capture | `verify-live`, `verify-deterministic`, `run-local-mcp`, `providers-up/down`, `install-and-run`, capture IntelliJ 2026-07-03 | OK |
| CI                | workflow GitHub Actions          | run `28391318969` success ; deux jobs verts             |         GitHub Actions | `Node.js 24 validation` success ; `Docker integration and live E2E` success                    | OK         |

### Environnement et commit testés

| Champ                | Valeur                                                 |
| -------------------- | ------------------------------------------------------ |
| Date de recette      | 2026-06-29                                             |
| Branche              | `master`                                               |
| Commit testé         | `08fd7dbdfeeca3cfa76f0857740af2bed761cc47`             |
| État initial Git     | `?? mcp-search-net.iml` déjà non suivi ; laissé intact |
| Node.js              | `v24.17.0`                                             |
| npm                  | `11.13.0`                                              |
| Docker client/server | `29.5.3` / Docker Desktop `4.79.0 (230596)`            |
| Docker Compose       | `v5.1.4`                                               |
| GitHub Actions       | run `28391318969` — success                            |

### Extrait `tools/list`

```json
["fetch_url", "search_web"]
```

### Extrait `search_web`

```json
{
  "query": "Example Domain",
  "status": "partial",
  "requestId": "a801f63b-18c6-43f0-8f2e-d3d679c13fb1",
  "cacheStatus": "MISS",
  "resultCount": 5,
  "firstResultUrl": "https://www.iana.org/help/example-domains",
  "sourceStatus": "UNKNOWN",
  "warnings": ["RESULTS_TRUNCATED", "DATE_UNAVAILABLE", "SEARCH_PROVIDER_PARTIAL_FAILURE"]
}
```

### Extrait `fetch_url`

```json
{
  "requestedUrl": "https://www.iana.org/help/example-domains",
  "finalUrl": "https://www.iana.org/help/example-domains",
  "title": "Example Domains",
  "contentType": "text/html",
  "extractionMode": "static",
  "sectionCount": 3,
  "cacheStatus": "MISS",
  "sectionExcerpt": "# Example Domains As described in RFC 2606 and RFC 6761, a number of domains such as example.com and example.org are maintained for documentation purposes."
}
```

Le contrat `native-render` reste inchangé et a été vérifié par la suite live dans `tests/e2e/services-live.test.ts` (`uses the real Crawl4AI adapter from the host in auto mode`). L'extraction publique archivée ci-dessus a utilisé le mode `static` car la page IANA était exploitable sans rendu natif.

### Preuve cache

```json
{
  "firstCall": "MISS",
  "secondCall": "HIT",
  "secondRequestId": "55a1115d-677b-4dfe-b331-a05fa251c6ba"
}
```

### Preuve SSRF

```json
{
  "target": "http://127.0.0.1",
  "isError": true,
  "requestId": "3abc3274-70cb-45cb-8788-9589e0e62a18",
  "code": "BLOCKED_ADDRESS",
  "retryable": false,
  "providerCallsForRequest": 0,
  "urlBlockedEvent": {
    "event": "url_blocked",
    "tool": "fetch_url",
    "code": "BLOCKED_ADDRESS"
  }
}
```

### Logs `stderr` structurés utiles

```json
{"event":"server_started"}
{"event":"tool_call_completed","tool":"search_web","requestId":"a801f63b-18c6-43f0-8f2e-d3d679c13fb1","cacheStatus":"MISS","status":"partial","resultCount":5}
{"event":"tool_call_completed","tool":"search_web","requestId":"55a1115d-677b-4dfe-b331-a05fa251c6ba","cacheStatus":"HIT","status":"partial","resultCount":5}
{"event":"tool_call_completed","tool":"fetch_url","requestId":"7f073e55-3e78-4c19-9ebe-89dc6c515af0","cacheStatus":"MISS","status":"partial","sectionCount":3}
{"event":"url_blocked","tool":"fetch_url","requestId":"3abc3274-70cb-45cb-8788-9589e0e62a18","code":"BLOCKED_ADDRESS"}
```

Les logs archivés ne contiennent ni token, ni secret, ni environnement complet, ni corps documentaire complet.

### État Docker final

- `docker compose logs --no-color --tail=200 searxng` collecté : service démarré, SearXNG `2026.6.20-fd42d4fda`, avertissements moteurs externes observés (`brave` rate-limit, `wikidata` 502, `startpage` CAPTCHA). Ces avertissements expliquent le statut `partial` de la recherche live, sans empêcher la réponse structurée ni les tests.
- `docker compose logs --no-color --tail=200 crawl4ai` collecté : gunicorn/uvicorn et endpoint `11235` démarrés, rendu `Raw HTML` réussi pendant les tests.
- `docker compose down` exécuté avec succès.
- `docker compose ps -a` après arrêt : aucune ligne de conteneur projet.
- Vérification processus Node de test : requête CIM initialement bloquée par le sandbox, relancée avec accès hors sandbox ; aucun processus `node.exe` correspondant à `mcp-search-net`, `vitest`, `run-live-tests` ou `build/bootstrap/main.js` trouvé.

### Recette IntelliJ

AC-02 IntelliJ/Copilot : VALIDÉ

Preuve :

- mcp-search-net détecté dans IntelliJ/Copilot
- statut : Running
- outils détectés :
  - search_web
  - fetch_url

Capture :
Capture d’écran 2026-07-03 23:01:35

Preuves manuelles fournies le 29 juin 2026 :

- `verify-live.cmd` : SearXNG et Crawl4AI `Healthy`, puis `REQUIRED_SUITE_VALID e2e-live: 7 passed, 0 skipped`.
- `verify-deterministic.cmd` : `tests/e2e/mcp-stdio.test.ts`, `2 passed`.
- `run-local-mcp.cmd` : build TypeScript, providers `Healthy`, log `server_started`, arrêt `server_stopped` avec `reason: SIGINT` et `exitCode: 0`.
- `providers-up.cmd` : deux conteneurs `healthy`, ports `127.0.0.1:8888` et `127.0.0.1:11235`.
- `providers-down.cmd` : conteneurs et réseaux Compose supprimés.
- `install-and-run.cmd` : installation utilisateur complète, `npm run check` vert, 139 tests globaux passés, providers utilisateur `Healthy`, serveur MCP lancé puis arrêté proprement.
- Contrôle complémentaire du nom Compose canonique : le lanceur installé `mcp-search-net-services.cmd up -d --wait searxng crawl4ai` crée `mcp-search-net-crawl4ai-1` et `mcp-search-net-searxng-1` en `healthy`, sans suffixe `user`; `mcp-search-net-services.cmd down` supprime ensuite conteneurs et réseaux, puis `docker ps --filter name=mcp-search-net` ne retourne aucune ligne.
- Capture IntelliJ/Copilot fournie le 3 juillet 2026 : écran `Configure Tools`, serveur `mcp-search-net` en état `Running`, exactement deux outils visibles et cochés, `search_web` et `fetch_url`.

Preuves correctives ajoutées le 3 juillet 2026 :

- `install-user.cmd` détecte une ancienne instance MCP verrouillante avant le remplacement de `%LOCALAPPDATA%\mcp-search-net\app`, affiche PID/nom/ligne de commande et échoue proprement sans erreur brute `Access is denied`.
- Après arrêt manuel des PID détectés, `install-user.cmd` réussit ; un deuxième appel immédiat réussit également.
- `install-and-run.cmd` est validé via un client MCP STDIO : `tools/list` retourne `["fetch_url", "search_web"]`, avec les diagnostics sur `stderr`.

Impact :
V1 OPÉRATIONNELLE ET VALIDÉE
V2 BUILD GO

### CI

CI GitHub Actions : VALIDÉE

Run : `28391318969`  
Résultat : `success`

Jobs :

- `Node.js 24 validation` : `success`
- `Docker integration and live E2E` : `success`

La réserve CI finale est levée.

### Limites restantes

- La recherche live a réussi avec résultats, mais certains moteurs SearXNG externes ont répondu en erreur ou avec limitation ; le serveur a exposé ces conditions via warnings et statut `partial`.
- Le fichier `mcp-search-net.iml` était déjà non suivi avant la recette et n'a pas été modifié.

## 9. Verdict final

```text
V1 OPÉRATIONNELLE ET VALIDÉE
V2 BUILD GO
```

Motif : toute la séquence automatisable est verte, Docker est disponible, les deux outils MCP fonctionnent, MISS/HIT et SSRF sont prouvés, la CI finale est verte, le lancement manuel IntelliJ/Windows est validé, et l'interface IntelliJ/Copilot affiche le serveur `mcp-search-net` en état `Running` avec les deux outils `search_web` et `fetch_url`.
