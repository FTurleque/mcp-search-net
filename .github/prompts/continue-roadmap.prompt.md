---
name: Continue Roadmap
description: >
  Implémente la prochaine phase incomplète de la roadmap mcp-search-net avec tests,
  preuves de validation et mise à jour explicite du statut. Chaque item n'est marqué
  terminé qu'avec sa condition de sortie démontrée.
mode: agent
agent: project-maintainer
tools:
  - codebase
  - editFiles
  - runCommands
  - fetch
  - problems
owner: mcp-search-net
version: 1.1.0
lastReviewed: '2026-06-21'
---

# Continuation roadmap — mcp-search-net

## Phase cible

> **Indique** la phase à implémenter ou laisse vide pour que l'agent prenne la première phase incomplète :
> Référence : `docs/planning/roadmap-v1-operationnelle.md`

## Ce que l'agent doit faire

1. **Lire** la phase cible en entier, incluant sa condition de sortie.
2. **Auditer** l'implémentation actuelle avant tout changement — ne pas assumer que rien n'est fait.
3. **Convertir** chaque item de la checklist en critère d'acceptation testable.
4. **Implémenter** la phase de façon cohérente : code, configuration, tests, documentation.
5. **Valider** : `npm run check` sous Node 24, tests live si disponibles et pertinents.
6. **Créer ou mettre à jour** un rapport de validation dans `docs/planning/validation-phase-X.md`.
7. **Mettre à jour** la roadmap : marquer uniquement les items avec preuve démontrée.

## Règles de progression

- Un item roadmap n'est marqué ✓ que si sa condition de sortie est satisfaite et documentée.
- Un item partiellement implémenté reste ⏳ avec une note sur ce qui manque.
- Les items dépendant de tests live (SearXNG, Crawl4AI) restent 🔲 tant que les services ne sont pas disponibles.
- Ne pas implémenter des phases ultérieures pour "anticiper" — respecter l'ordre de la roadmap.

## Critères de complétion de cette session

- [ ] Phase cible entièrement implémentée ou blocants documentés
- [ ] Tests ajoutés pour tous les nouveaux comportements
- [ ] `npm run check` propre sous Node 24
- [ ] Rapport de validation créé/mis à jour dans `docs/planning/`
- [ ] Roadmap mise à jour avec statut réel et preuves
- [ ] Documentation de référence alignée si contrats modifiés
