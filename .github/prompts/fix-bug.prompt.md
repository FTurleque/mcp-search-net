---
name: Fix Bug
description: >
  Reproduit et corrige un défaut de mcp-search-net avec analyse de cause racine,
  test de régression ciblé et impact minimal sur les contrats publics.
mode: agent
agent: bug-fixer
tools:
  - codebase
  - editFiles
  - runCommands
  - problems
owner: mcp-search-net
version: 1.1.0
lastReviewed: '2026-06-21'
---

# Correction de défaut — mcp-search-net

## Contexte du bug

> **Décris ici** : comportement observé, comportement attendu, entrée minimale qui reproduit le problème, couche suspectée (domain / application / infrastructure / presentation / bootstrap).

## Ce que l'agent doit faire

1. **Reproduire** le défaut par un test avant toute modification.
2. **Tracer** la cause racine à travers les couches architecturales sans spéculer.
3. **Ajouter** un test de régression qui échoue sur la cause racine démontrée.
4. **Corriger** au niveau le plus bas approprié, en préservant tous les contrats publics.
5. **Valider** : `npm run typecheck` minimum, `npm run check` si cross-layer.

## Contrats publics à préserver impérativement

- Schémas `search_web` et `fetch_url` inchangés (sauf si le bug est contractuel)
- Codes d'erreur stables existants
- Champs `requestId`, `sourceUrl`, `cacheStatus`, `warnings` dans les réponses
- stdout exclusivement JSON-RPC MCP
- Aucun secret ni stack trace dans les erreurs ou logs

## Critères d'acceptation de la correction

- [ ] Test de régression ajouté dans `tests/<layer>/`
- [ ] Test rouge avant le fix, vert après
- [ ] `npm run typecheck` propre
- [ ] `npm run check` propre si le changement touche plusieurs couches
- [ ] Aucune modification non liée dans `git status --short`
