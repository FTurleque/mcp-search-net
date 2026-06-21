---
name: Audit Project
description: >-
  Audit de santé complète du dépôt mcp-search-net en lecture seule : architecture,
  sécurité, tests, documentation et alignement roadmap. Produit un rapport de findings
  ordonné par sévérité avec preuves exactes et plan de maintenance priorisé.
mode: agent
agent: project-maintainer
owner: mcp-search-net
version: 1.1.0
lastReviewed: '2026-06-21'
---

# Audit de santé du projet — mcp-search-net

## Ce que l'agent doit faire

1. **Inspecter** `git status --short` — noter les modifications non committées.
2. **Exécuter** `node .github/skills/maintain-mcp-search-net/scripts/project-snapshot.mjs` pour une vue large.
3. **Auditer** dans cet ordre :

### Périmètre d'audit

#### Architecture
- Frontières hexagonales : `domain` sans import infra, handlers MCP sans logique métier
- Ports application pour chaque dépendance externe
- Composition dans `bootstrap/` uniquement

#### Tests et CI
- Suite déterministe offline complète (`npm run check`)
- Tests E2E opt-in derrière variables d'environnement
- Couverture hostile/boundary sur chemins security-sensitive
- CI : Node 24, `npm ci`, `npm run check`, permissions minimales

#### Contrats publics
- `search_web` et `fetch_url` : schémas Zod alignés avec `docs/reference/tools.md`
- Codes d'erreur stables documentés et cohérents avec le code
- Champs de réponse obligatoires présents

#### Documentation
- `docs/reference/` : contrats, configuration, architecture, sécurité
- `docs/planning/` : roadmap avec preuves pour chaque item ✓
- Liens dans `docs/README.md` valides

#### Roadmap
- Items marqués terminés avec condition de sortie démontrée
- Items bloqués avec raison documentée

## Format de sortie

```
## Résumé : X défauts confirmés, Y améliorations, Z dette technique

### Défauts confirmés (par sévérité)
- [CRITIQUE] Titre — fichier:ligne — critère d'acceptation impacté

### Améliorations recommandées

### Checks exécutés / indisponibles

### Plan de maintenance priorisé
1. ...
```

## Règle absolue

Lecture seule pendant cet audit. Si des corrections sont souhaitées, utilise le prompt `fix-bug` ou `add-feature` dans une session dédiée.
