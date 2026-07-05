# Statut V2.8 — prochaines étapes hors CI — 2026-07-05

## Statut

La V2.8 applicative est validée localement.

Validation confirmée :

- format : OK ;
- lint : OK ;
- typecheck : OK ;
- build : OK ;
- tests : OK ;
- 36 fichiers de tests passés ;
- 182 tests passés.

## Livré

- `search_docs` compact.
- `maxSnippetChars` sur `search_docs`.
- `list_docs`.
- `read_doc_section`.
- documentation du workflow sobre Copilot.

Workflow cible :

```text
search_docs compact -> read_doc_section ciblé
```

## Reste à faire hors CI

1. Mettre à jour la roadmap V2 avec la V2.8.
2. Mettre à jour le body de la PR #8.
3. Mettre à jour l'issue #9.
4. Exécuter le spike final IntelliJ/Copilot.
5. Vérifier que Copilot utilise les outils sobres sans lire tout le catalogue.
6. Alléger ensuite les resources globales si nécessaire.
7. Ajouter un benchmark de taille des réponses MCP.
8. Nettoyer progressivement la dette Prettier/ESLint V2.

## Incident installation utilisateur

Une tentative d'installation utilisateur a validé le projet, puis s'est interrompue parce qu'une instance précédente de `mcp-search-net` était encore active dans le dossier utilisateur.

Ce comportement protège l'installation contre un remplacement pendant que l'application est encore utilisée.

Action attendue : fermer le client qui utilise le MCP, nettoyer le staging indiqué par l'installateur, puis relancer l'installation.

Amélioration à prévoir : documenter ce cas dans le dépannage et ajouter une option claire de relance avec arrêt explicite de l'ancienne instance.
