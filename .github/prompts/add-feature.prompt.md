---
name: Add Feature
description: >-
  Implémente une nouvelle fonctionnalité end-to-end dans mcp-search-net avec
  architecture, contrats de sécurité, couverture de tests et documentation alignés.
mode: agent
agent: feature-engineer
owner: mcp-search-net
version: 1.1.0
lastReviewed: '2026-06-21'
---

# Ajout de fonctionnalité — mcp-search-net

## Description de la fonctionnalité

> **Décris ici** : ce que la fonctionnalité doit faire, le périmètre autorisé par la roadmap, et toute contrainte connue.

## Ce que l'agent doit faire

1. **Dériver** des critères d'acceptation testables (nominal, limite, dégradé, hostile).
2. **Cartographier** le changement sur les couches : domain → application → infrastructure → presentation/mcp → bootstrap.
3. **Threat-modeler** les nouvelles entrées et interactions externes avant de coder.
4. **Implémenter** couche par couche, en commençant par les types domain et les ports application.
5. **Tester** avec des tests déterministes offline ; indiquer explicitement ce qui requiert un test live.
6. **Documenter** : `docs/reference/tools.md`, `docs/reference/configuration.md` si nécessaire.
7. **Valider** : `npm run check` sous Node 24 avant de conclure.

## Invariants V1 non négociables

- Exactement `search_web` et `fetch_url` exposés — pas d'outil supplémentaire
- `search_web` découvre des URLs, ne télécharge jamais les pages résultats
- `fetch_url` lit une URL publique connue — ne suit pas de liens ni ne remplit de formulaires
- SQLite reste un cache, pas un index permanent
- Toutes les limites (résultats, taille, timeout, redirects) restent côté serveur

## Périmètre autorisé

> Référence le numéro de phase ou d'item roadmap qui autorise ce développement :
> `docs/planning/roadmap-v1-operationnelle.md` — Phase X, item Y

## Critères d'acceptation

- [ ] Comportement nominal testé et documenté
- [ ] Cas limites et dégradés couverts
- [ ] Inputs hostiles rejetés proprement (aucun effet de bord)
- [ ] Aucune dépendance infra directe dans `src/domain/`
- [ ] Nouveaux providers derrière un port `application/ports/`
- [ ] `npm run check` propre sous Node 24
- [ ] Documentation de référence mise à jour
