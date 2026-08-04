---
name: Deployment Configuration Automation
description: >
  Contraintes de déploiement, configuration, automation et CI pour mcp-search-net :
  Node 24, lockfile, images pinnées, secrets en input d'environnement, services
  loopback-bound, least-privilege Docker, et stdout propre depuis le launcher.
applyTo: 'Dockerfile,compose.yaml,config/**/*.yml,scripts/**/*.ps1,scripts/**/*.cmd,.github/workflows/**/*.yml'
owner: mcp-search-net
version: 1.1.0
lastReviewed: '2026-06-21'
---

# Déploiement, configuration et automation — mcp-search-net

## Runtime et reproductibilité

- **Node 24 est obligatoire** : déclaré dans `package.json` engines, utilisé dans tous les workflows CI.
- Utiliser `npm ci` (jamais `npm install`) dans CI et dans les scripts de build reproductibles.
- Le `package-lock.json` est versioné et doit rester cohérent avec `package.json`.

```yaml
# ✅ .github/workflows/ci.yml — Node 24 et npm ci
- uses: actions/setup-node@v4
  with:
    node-version: '24'
    cache: 'npm'
- run: npm ci
```

## Docker et services

### Images pinnées avec digest

```dockerfile
# ✅ Image avec digest SHA256
FROM node:24-alpine@sha256:<hash>

# ❌ Tag seul — non reproductible
FROM node:24-alpine
```

```yaml
# ✅ compose.yaml — service avec digest
services:
  searxng:
    image: searxng/searxng@sha256:<hash>
```

### Binding réseau

| Environnement | SearXNG et Crawl4AI                    |
| ------------- | -------------------------------------- |
| Développement | `127.0.0.1` (loopback uniquement)      |
| Full Compose  | Réseau interne Docker `internal: true` |

```yaml
# ✅ Dev — loopback uniquement
ports:
  - "127.0.0.1:8080:8080"

# ❌ Accessible depuis le réseau hôte
ports:
  - "8080:8080"
```

### Hardening containers

```dockerfile
# ✅ Least-privilege
USER node
RUN chmod -R o-w /app

# compose.yaml
read_only: true
tmpfs:
  - /tmp:size=64m,mode=1777
cap_drop:
  - ALL
security_opt:
  - no-new-privileges:true
```

### Healthchecks

```yaml
# ✅ Healthcheck défini pour chaque service critique
healthcheck:
  test: ['CMD-SHELL', 'wget -qO- http://localhost:8080/healthz || exit 1']
  interval: 30s
  timeout: 10s
  retries: 3
  start_period: 10s
```

## Installation Windows

- Installer sous `%LOCALAPPDATA%\mcp-search-net` — jamais sous `Program Files` (pas d'élévation requise).
- Préserver la configuration et les données utilisateur lors d'une mise à jour.
- `scripts/install-user.ps1` doit être idempotent : une réinstallation ne détruit pas les données existantes.
- `scripts/uninstall-user.ps1` doit supprimer uniquement les fichiers de l'application, pas les données utilisateur sauf confirmation.

```powershell
# ✅ Préservation de la config utilisateur
$configPath = "$env:LOCALAPPDATA\mcp-search-net\config\application.yml"
if (-not (Test-Path $configPath)) {
    Copy-Item "$PSScriptRoot\..\config\application.user.yml" $configPath
}
# Ne pas écraser si déjà présent
```

## Launcher MCP — stdout propre

**Règle absolue** : le script launcher MCP ne produit **aucun texte informatif vers stdout**.

```cmd
@echo off
REM ✅ Correct — stdout exclusivement pour le processus Node
node "%LOCALAPPDATA%\mcp-search-net\app\build\bootstrap\main.js"

REM ❌ Interdit — corrompt le JSON-RPC
echo Starting MCP server...
node "%LOCALAPPDATA%\mcp-search-net\app\build\bootstrap\main.js"
```

## CI — permissions minimales

```yaml
# ✅ Permissions minimales déclarées
permissions:
  contents: read

# ❌ Permissions trop larges
permissions: write-all
```

```yaml
# ✅ Actions communauté pinnées avec hash de commit
- uses: actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683 # v4.2.2

# ❌ Tag seul — non épinglé
- uses: actions/checkout@v4
```

## Secrets et configuration

- Les secrets (API keys, tokens) sont **des inputs d'environnement uniquement** — jamais committés.
- `config/application.yml` contient des valeurs structurelles (URLs, limites, timeouts) — pas de credentials.
- L'installation conserve les personnalisations dans `config/application.yml`; `config/application.user.yml` reste le modèle distribué.

```yaml
# ✅ Secret en variable d'environnement
services:
  app:
    environment:
      - SEARXNG_API_KEY=${SEARXNG_API_KEY} # depuis .env local ou CI secret

# ❌ Secret en dur
environment:
  - SEARXNG_API_KEY=my-real-key
```

## Validation après modification

```powershell
# Après tout changement Compose
docker compose config --quiet

# Après tout changement de scripts installation
# Tester sur une machine propre : première install + réinstall
```
