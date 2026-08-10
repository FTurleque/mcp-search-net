# Documentation d'architecture — mcp-search-net

> Version documentaire : 1.1.0 · Méthode : arc42 + C4 · Diagrammes : Mermaid

## Finalité

Ce dossier contient la documentation d'architecture du serveur MCP `mcp-search-net`, organisée selon le template arc42 et illustrée par des diagrammes C4 en Mermaid. Il n'est pas une source de vérité sur l'état de livraison ; l'état autoritatif est [`docs/status/current-state.md`](../status/current-state.md). La certification native des clients MCP est suivie séparément dans [`docs/planning/client-certification-current.md`](../planning/client-certification-current.md).

## Structure

```
docs/architecture/
├── README.md             # ce fichier — index de navigation
├── arc42/
│   ├── 01-introduction-objectifs.md   # section 1 — résumé, objectifs, parties prenantes
│   ├── 02-contraintes.md              # section 2 — contraintes imposées
│   ├── 03-contexte-perimetre.md       # section 3 — frontière et contexte C4 Level 1
│   ├── 04-strategie-solution.md       # section 4 — principes et technologie structurante
│   ├── 05-vue-blocs.md                # section 5 — C4 Level 2 Container + Level 3 Component
│   ├── 06-vue-execution.md            # section 6 — scénarios nominaux et d'erreur (sequenceDiagram)
│   ├── 07-vue-deploiement.md          # section 7 — environnements et topologie de déploiement
│   ├── 08-concepts-transverses.md     # section 8 — sécurité, erreurs, cache, observabilité …
│   ├── 09-decisions.md                # section 9 — index des ADR
│   ├── 10-exigences-qualite.md        # section 10 — scénarios qualité avec seuils mesurés
│   ├── 11-risques-dette.md            # section 11 — risques et dette technique
│   └── 12-glossaire.md               # section 12 — termes et acronymes
├── adr/
│   ├── README.md         # index des ADR de ce dossier (les ADR historiques sont dans docs/adr/)
│   └── template.md       # gabarit d'ADR
├── diagrams/             # réservé aux diagrammes exportés si besoin
├── quality/
│   └── scenarios.md      # scénarios qualité détaillés
└── risks/
    └── register.md       # registre de risques priorisé
```

## Navigation rapide

| Besoin                               | Section                                                 |
| ------------------------------------ | ------------------------------------------------------- |
| Qu'est-ce que ce système ?           | [01 — Introduction](arc42/01-introduction-objectifs.md) |
| Quelles contraintes s'appliquent ?   | [02 — Contraintes](arc42/02-contraintes.md)             |
| Quels acteurs et systèmes externes ? | [03 — Contexte](arc42/03-contexte-perimetre.md)         |
| Comment est structuré le code ?      | [05 — Vue blocs](arc42/05-vue-blocs.md)                 |
| Comment fonctionne une recherche ?   | [06 — Vue exécution](arc42/06-vue-execution.md)         |
| Comment le système est-il déployé ?  | [07 — Vue déploiement](arc42/07-vue-deploiement.md)     |
| Quelles décisions ont été prises ?   | [09 — Décisions (index ADR)](arc42/09-decisions.md)     |
| Quels sont les risques ouverts ?     | [11 — Risques et dette](arc42/11-risques-dette.md)      |

## Conventions

- Chaque information non vérifiable dans le code source est marquée **Hypothèse à valider**.
- Les noms d'éléments dans les diagrammes correspondent exactement aux noms de fichiers et de classes du code.
- Les ADR historiques se trouvent dans [`docs/adr/`](../adr/) ; les nouveaux ADR doivent y être créés.
