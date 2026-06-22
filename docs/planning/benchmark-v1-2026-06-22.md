# Benchmark V1 — 22 juin 2026

Commande : `npm run benchmark:v1`, Node.js 24.14.0, SearXNG et Crawl4AI
sains. Chaque scénario effectue deux recherches identiques, puis extrait la page
du domaine officiel attendu lorsqu’elle est présente dans le top 5.

## Synthèse

| Mesure                                  |         Résultat |
| --------------------------------------- | ---------------: |
| Scénarios                               |               10 |
| Résultats classés `VERIFIED_OFFICIAL`   |           42,5 % |
| Domaine officiel attendu dans le top 5  |             50 % |
| Résultats portant une date              |              0 % |
| Extractions réussies                    |             50 % |
| Contexte moyen des extractions réussies | 4 792 caractères |
| Recherche MISS moyenne                  |       875,093 ms |
| Recherche HIT moyenne                   |         1,271 ms |

## Résultats par scénario

| Technologie    | Rang officiel attendu | Officiels / résultats |       MISS / HIT | Extraction      | Contexte |
| -------------- | --------------------: | --------------------: | ---------------: | --------------- | -------: |
| GitHub Copilot |                     1 |                 4 / 5 |   852 / 1,630 ms | oui, 5 sections |    2 288 |
| MCP            |                     2 |                 4 / 5 |   780 / 1,157 ms | oui, 5 sections |    1 535 |
| JetBrains      |                     1 |                 3 / 5 | 1 152 / 1,248 ms | oui, 1 section  |      548 |
| Java / OpenJDK |                     2 |                 3 / 5 | 1 799 / 1,318 ms | oui, 5 sections |    7 599 |
| Maven          |                absent |                 0 / 5 |   733 / 1,286 ms | non             |        — |
| Quarkus        |                absent |                 0 / 0 |   753 / 1,074 ms | non             |        — |
| JavaFX         |                absent |                 0 / 5 |   379 / 1,204 ms | non             |        — |
| Oracle         |                     1 |                 3 / 5 |   871 / 1,303 ms | oui, 5 sections |   11 990 |
| Sonar          |                absent |                 0 / 5 |   392 / 1,356 ms | non             |        — |
| Docker         |                absent |                 0 / 0 | 1 040 / 1,135 ms | non             |        — |

Les extractions réussies sont toutes des MISS lors de cette passe. Les réponses
ont correctement exposé les avertissements de troncature lorsque les budgets ont
été atteints.

## Lecture des résultats

- Le cache réduit fortement la latence des recherches répétées.
- La recherche et l’extraction fonctionnent réellement sur cinq écosystèmes.
- La pertinence dépend encore fortement des moteurs SearXNG actifs : Maven,
  Quarkus, JavaFX, Sonar et Docker n’ont pas fourni le domaine attendu dans le top 5.
- La fraîcheur ne peut pas être évaluée avec cette configuration, car aucun
  résultat ne contient de date. Le taux de 0 % est conservé comme signal de limite.
- La résilience est mesurée séparément par `test:resilience` et les scénarios
  fournisseurs indisponibles de `test:integration`.

Le benchmark mesure l’environnement à un instant donné ; il n’est pas un test
déterministe et ses scores ne constituent pas un seuil de livraison.
