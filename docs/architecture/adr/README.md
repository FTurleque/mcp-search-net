# ADR — Architecture Decision Records

> Nouveau dossier dans `docs/architecture/adr/`

Les **ADR historiques du projet** (ADR-001 à ADR-018) se trouvent dans [`docs/adr/`](../../adr/). Leur index est dans la [section 9 de arc42](../arc42/09-decisions.md).

Ce dossier accueille les **futurs ADR** produits après la mise en place de cette documentation d'architecture.

## Règles de création

Créer un ADR lorsqu'un choix :

- est coûteux à inverser ;
- modifie une frontière ou une dépendance majeure ;
- engage une technologie structurante ;
- répond à un objectif qualité critique ;
- introduit un risque important ;
- a nécessité de comparer plusieurs options.

Ne jamais supprimer un ADR accepté. En cas de changement, créer un nouvel ADR et marquer l'ancien `Remplacé`.

## Nommage

```
ADR-NNN-slug-descriptif.md
```

où `NNN` est le prochain numéro dans la séquence globale (actuellement : 019).

## Gabarit

Voir [`template.md`](template.md).
