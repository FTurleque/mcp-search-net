---
name: Documentation
description: >
  Conventions de rédaction et d'organisation de la documentation de mcp-search-net :
  français clair, comportements validés uniquement, organisation par dossier, liens
  relatifs valides, et roadmap avec preuves reproductibles.
applyTo: 'docs/**/*.md,README.md'
owner: mcp-search-net
version: 1.1.0
lastReviewed: '2026-06-21'
---

# Documentation — mcp-search-net

## Langue et style

- Rédige en **français clair et direct**. Évite le jargon inutile.
- Les commandes terminal sont **copiables telles quelles** sur la plateforme documentée (Windows PowerShell pour les scripts `.ps1`, Linux/macOS pour les commandes Docker).
- Les noms de fichiers, commandes, paramètres, et valeurs de configuration sont en `code inline`.
- Les sections longues utilisent des titres H2/H3 avec ancres descriptives.

````markdown
<!-- ✅ Correct — français, commande copiable -->

## Installation

Exécute le script d'installation depuis le répertoire du projet :

```powershell
.\scripts\install-user.ps1
```
````

<!-- ❌ Incorrect — anglais, commande non copiable -->

## Setup

Run the install script.

````

## Contenu et précision

### Ne décrire que le comportement implémenté et validé

```markdown
<!-- ✅ État actuel clair -->
## Outil `search_web`
Renvoie jusqu'à 10 résultats de recherche avec URL, titre et extrait.
**Limitation** : les pages résultats ne sont pas téléchargées.

<!-- ❌ Comportement futur présenté comme actuel -->
## Outil `search_web`
Renvoie les résultats avec analyse sémantique et scoring de pertinence.
````

### Séparer clairement état actuel, planifié, et limites connues

Utiliser des admonitions ou des sections distinctes :

```markdown
> **Limitation V1** : SQLite est un cache de session, pas un index permanent.
> Les résultats ne persistent pas entre les redémarrages.

> **Prévu en V2** : historique des recherches persistant.
```

## Organisation par dossier

| Dossier                 | Contenu                                                            |
| ----------------------- | ------------------------------------------------------------------ |
| `docs/reference/`       | Contrats publics, configuration, architecture, sécurité            |
| `docs/operations/`      | Troubleshooting opérationnel, mise à jour, résolution de problèmes |
| `docs/development/`     | Guide contributeur, testing, outils de développement               |
| `docs/getting-started/` | Installation, premier usage, intégration IDE                       |
| `docs/planning/`        | Roadmap, preuves de validation, décisions d'architecture           |

**Règle** : toute nouvelle page utilisateur est listée dans `docs/README.md` avec une courte description.

## Liens relatifs et validité

- Utiliser des **liens relatifs** entre pages de documentation.
- Vérifier les liens après tout déplacement ou renommage de fichier.
- Les ancres (`#titre`) doivent correspondre exactement au titre cible (en minuscules, espaces remplacés par `-`).

```markdown
<!-- ✅ Lien relatif valide -->

Voir [configuration de référence](../reference/configuration.md#limites-de-contenu).

<!-- ❌ Lien absolu fragile -->

Voir [configuration](https://github.com/user/mcp-search-net/blob/main/docs/reference/configuration.md).
```

## Roadmap et critères d'acceptation

- Un item roadmap n'est marqué **✓ terminé** que si :
  1. Sa condition de sortie est satisfaite
  2. Une preuve reproductible est documentée dans `docs/planning/validation-phase-X.md`
  3. La commande de validation est copiable et exécutable

```markdown
<!-- ✅ Item avec preuve -->

- [x] **Cache SQLite opérationnel**
  - Preuve : `npx vitest run tests/infrastructure/sqlite-cache-repository.test.ts` — 12 tests passed
  - Date : 2026-06-15

<!-- ❌ Item sans preuve -->

- [x] Cache SQLite opérationnel
```

## Mise à jour obligatoire

| Modification du code              | Documentation à mettre à jour                                                        |
| --------------------------------- | ------------------------------------------------------------------------------------ |
| Nouveau paramètre outil           | `docs/reference/tools.md`                                                            |
| Nouveau champ de configuration    | `docs/reference/configuration.md`                                                    |
| Nouveau code d'erreur public      | `docs/reference/tools.md#codes-derreur`                                              |
| Nouveau service ou container      | `docs/reference/architecture.md`                                                     |
| Nouvelle variable d'environnement | `docs/reference/configuration.md`                                                    |
| Nouvelle limitation de sécurité   | `docs/reference/security.md`                                                         |
| Phase roadmap complétée           | `docs/planning/roadmap-v1-operationnelle.md` + `docs/planning/validation-phase-X.md` |
