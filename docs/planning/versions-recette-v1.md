# Versions de la recette V1

Versions relevées le 22 juin 2026.

## Runtime et outillage

| Composant     | Version |
| ------------- | ------- |
| Node.js       | 24.14.0 |
| npm           | 11.9.0  |
| Docker Engine | 29.3.1  |
| TypeScript    | 5.9.3   |
| Vitest        | 4.1.9   |
| ESLint        | 9.39.1  |
| Prettier      | 3.6.2   |

## Dépendances d’exécution

| Composant                  | Version résolue |
| -------------------------- | --------------- |
| SDK Model Context Protocol | 1.29.0          |
| better-sqlite3             | 12.11.1         |
| pdfjs-dist                 | 6.0.227         |
| yaml                       | 2.9.0           |
| zod                        | 4.4.3           |

## Images

| Service  | Référence                      | Image ID               | Santé   |
| -------- | ------------------------------ | ---------------------- | ------- |
| SearXNG  | `searxng@sha256:d0f6ccf…b7082` | `sha256:d0f6ccf…b7082` | healthy |
| Crawl4AI | `unclecode/crawl4ai:0.9.0`     | `sha256:385042c…e644`  | healthy |

Les identifiants complets restent dans `compose.yaml` pour SearXNG et dans la
sortie archivée de recette pour Crawl4AI. Le tag Crawl4AI devrait être remplacé
par un digest avant une livraison strictement immuable.
