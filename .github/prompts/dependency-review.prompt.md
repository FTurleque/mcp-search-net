---
name: Dependency Review
description: >-
  Analyse en lecture seule les dépendances npm et images container de mcp-search-net :
  vulnérabilités connues, composants obsolètes, incompatibilités Node 24, et pinning
  de digest Docker. Produit un plan de mise à jour priorisé sans modifier ni installer.
mode: agent
agent: security-auditor
owner: mcp-search-net
version: 1.1.0
lastReviewed: '2026-06-21'
---

# Revue des dépendances — mcp-search-net

## Ce que l'agent doit faire

1. **Inspecter** `package.json`, `package-lock.json`, `Dockerfile`, `compose.yaml`, et `.github/workflows/ci.yml`.
2. **Exécuter** `npm audit --json` pour les vulnérabilités connues (lecture seule).
3. **Vérifier** la compatibilité avec Node 24 pour chaque dépendance directe.
4. **Identifier** les images Docker sans digest SHA256 pinné.
5. **Identifier** les GitHub Actions sans commit hash pinné.
6. **Ne pas** mettre à jour, installer, ni modifier de fichier.

## Périmètre d'analyse

### npm — dépendances runtime

- Vulnérabilités CVE avec score CVSS et vecteur d'exploitation
- Versions avec breaking changes connus vers la cible compatible Node 24
- Dépendances non maintenues (dernière release > 18 mois)
- Packages superflus ou remplaçables par des modules Node natifs

### npm — dépendances dev

- Mêmes critères de sécurité
- Versions d'outils (eslint, vitest, typescript) avec support Node 24 confirmé

### Docker

- `Dockerfile` : base image avec digest SHA256 (pas seulement un tag)
- `compose.yaml` : images services avec digest SHA256
- Versions de SearXNG et Crawl4AI — changelog de sécurité récent

### CI / GitHub Actions

- `.github/workflows/ci.yml` : actions de la communauté pinnées avec hash de commit
- Permissions déclarées minimales

## Format de sortie

```
## Résumé
- X vulnérabilités CVE (critique: A, élevé: B, moyen: C, faible: D)
- Y dépendances obsolètes
- Z images Docker non pinnées avec digest

## Vulnérabilités CVE
| Package | Version actuelle | CVE | CVSS | Version cible | Breaking changes |
|---------|-----------------|-----|------|--------------|-----------------|

## Plan de mise à jour priorisé
1. [CRITIQUE] package@x.y.z → x.y.z+1 — commande : npm install package@version
   Validation : npm test && npm run typecheck

## Images Docker à pinner
...

## Actions GitHub à pinner
...
```

## Règle absolue

Ne jamais exécuter `npm install`, `npm update`, `docker pull`, ni modifier aucun fichier pendant cette analyse.
