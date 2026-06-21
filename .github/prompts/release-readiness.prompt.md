---
name: Release Readiness
description: >-
  Évalue la readiness de release V1 de mcp-search-net en lecture seule stricte :
  tests, critères d'acceptation AC-01 à AC-15, packaging, sécurité, installation
  Windows et documentation. Rend un verdict GO / NO-GO documenté et actionnable.
mode: agent
agent: release-guardian
owner: mcp-search-net
version: 1.1.0
lastReviewed: '2026-06-21'
---

# Évaluation release readiness — mcp-search-net V1

## Ce que l'agent doit faire

1. **Vérifier** le runtime : `npm run check:runtime`, `node --version`, `package.json` engines.
2. **Exécuter** `npm run check` et noter chaque résultat réel.
3. **Évaluer** les critères d'acceptation AC-01 à AC-15 depuis `docs/planning/roadmap-v1-operationnelle.md`.
4. **Vérifier** les contrats publics `search_web` / `fetch_url` vs `docs/reference/tools.md`.
5. **Vérifier** Docker : digests SHA256, healthchecks, binding réseau.
6. **Vérifier** l'installation Windows : `scripts/install-user.ps1`, données utilisateur préservées.
7. **Vérifier** CI : Node 24, `npm ci`, permissions minimales.
8. **Ne pas** modifier de fichier, installer de paquet, ni démarrer de service.

## Critères de blocage absolus (NO-GO automatique)

- `npm run check` échoue
- Tests déterministes skippés sans justification documentée
- Texte informatif écrit sur stdout depuis le launcher MCP
- Secrets dans les fichiers versionés
- Node 24 non déclaré/utilisé en CI
- Images Docker sans digest SHA256 dans `Dockerfile` ou `compose.yaml`
- Contrats MCP non documentés ou incohérents avec le code

## Statut des tests live (à indiquer explicitement)

| Test | Disponible | Résultat |
|------|-----------|----------|
| SearXNG (`RUN_LIVE_SEARXNG=1`) | ☐ oui / ☐ non | ... |
| Crawl4AI (`RUN_LIVE_CRAWL4AI=1`) | ☐ oui / ☐ non | ... |
| Install Windows | ☐ oui / ☐ non | ... |
| IntelliJ Copilot | ☐ oui / ☐ non | ... |

**Important** : un test live non exécuté n'est pas considéré comme passé.

## Format de sortie

```
## Verdict : GO ✓ / NO-GO ✗

### Bloquants
- [critique] Description + fichier:ligne + remédiation en 1 étape

### Risques non-bloquants
- [moyen] Description + impact potentiel

### Critères d'acceptation
| ID | Critère | Statut | Preuve |
|----|---------|--------|--------|
| AC-01 | ... | ✓/✗/⏳ | ... |

### Checks exécutés
| Commande | Résultat |
|----------|----------|

### Chemin vers GO (si NO-GO)
1. ...
```
