---
name: Release Readiness
description: >-
  Évalue la readiness de release V1+V2 de mcp-search-net en lecture seule stricte :
  tests, contrats MCP, catalogue, packaging, sécurité, clients réels, installation
  Windows, Docker, CI et documentation. Rend un verdict GO / NO-GO exact-head.
mode: agent
agent: release-guardian
owner: mcp-search-net
version: 1.1.3
lastReviewed: '2026-08-23'
---

# Évaluation release readiness — mcp-search-net V1 + V2

## Ce que l'agent doit faire

1. **Vérifier** le runtime : `npm run check:runtime`, `node --version`, `package.json` engines.
2. **Exécuter** `npm run check` et noter chaque résultat réel.
3. **Lire** `docs/status/current-state.md` et `docs/planning/release-promotion-governance.md`, puis distinguer état courant et preuves historiques.
4. **Vérifier** les cinq outils, quatre resources et neuf templates vs `docs/reference/tools.md`.
5. **Vérifier** Docker : digests SHA256, healthchecks, binding réseau.
6. **Vérifier** l'installation Windows : `scripts/install-user.ps1`, données utilisateur préservées.
7. **Vérifier** CI : Node 24, `npm ci`, `docs:check`, audits, Windows, Docker, permissions minimales et SHA exact.
8. **Vérifier la topologie de promotion** : `master` ancêtre de `develop`, candidat sur `release/promote-develop-*`, un seul commit marqueur vide au-dessus du HEAD courant de `develop`, aucun changement de tree.
9. **Qualifier** séparément IntelliJ/Copilot, Codex Desktop et le client STDIO ; ne jamais substituer l'un à l'autre.
10. **Ne pas** modifier de fichier, installer de paquet, ni démarrer de service.

## Critères de blocage absolus (NO-GO automatique)

- `npm run check` échoue
- `npm run docs:check` ou un audit npm échoue
- Tests déterministes skippés sans justification documentée
- Texte informatif écrit sur stdout depuis le launcher MCP
- Secrets dans les fichiers versionés
- Node 24 non déclaré/utilisé en CI
- Images Docker sans digest SHA256 dans `Dockerfile` ou `compose.yaml`
- Contrats MCP, catalogue ou resources non documentés ou incohérents avec le code
- PR directe `develop -> master`
- `master` n'est pas ancêtre de `develop` au moment de préparer la promotion
- branche de promotion dont le parent direct n'est pas le HEAD courant de `develop`
- branche de promotion qui modifie le tree de `develop`
- un check affiché `Required` par GitHub n'est pas `Successful` (`skipped`, `cancelled`, `pending`, `queued`, `timed_out`, `stale`, `missing` ou échec)
- branche `out-of-date` lorsque la protection exige une branche à jour
- bypass de ruleset nécessaire pour merger

Un run plus récent réussi ne permet jamais de reclasser un item GitHub encore affiché `Required` et non réussi comme historique ou bruit.

## Statut des tests live (à indiquer explicitement)

| Test                             | Disponible    | Résultat |
| -------------------------------- | ------------- | -------- |
| SearXNG (`RUN_LIVE_SEARXNG=1`)   | ☐ oui / ☐ non | ...      |
| Crawl4AI (`RUN_LIVE_CRAWL4AI=1`) | ☐ oui / ☐ non | ...      |
| Install Windows                  | ☐ oui / ☐ non | ...      |
| IntelliJ Copilot                 | ☐ oui / ☐ non | ...      |

**Important** : un test live non exécuté n'est pas considéré comme passé.

## Autorisations

- Une autorisation explicite est requise immédiatement avant tout merge.
- Une autorisation de merge vers `develop` ne vaut pas autorisation de promotion vers `master`.
- Une autorisation de merge vers `master` ne vaut pas autorisation de publication.
- `Publish Windows Release` avec `validate_only=false` nécessite une autorisation de publication séparée.

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
