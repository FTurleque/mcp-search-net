# Validation des phases 8 et 9

Validation réalisée le 22 juin 2026 sous Node.js 24.14.0.

## Verdict

- **Phase 8 : terminée.** Les suites déterministes, spécialisées, d’intégration et
  E2E réelles passent sans test ignoré ; les rapports JSON sont générés et publiés
  par la CI.
- **Phase 9 : partiellement terminée.** Documentation, ADR, traçabilité, benchmark
  et versions sont archivés. La recette visuelle dans IntelliJ reste à exécuter
  par un opérateur disposant de GitHub Copilot ; AC-02 reste donc non prouvé.

## Preuves automatisées

| Commande                   | Résultat                                            |
| -------------------------- | --------------------------------------------------- |
| `npm run check`            | 20 fichiers, 126 tests réussis                      |
| `npm run test:required`    | 126 réussis, 0 ignoré                               |
| `npm run test:unit`        | 55 réussis, 0 ignoré                                |
| `npm run test:contract`    | 6 réussis, 0 ignoré                                 |
| `npm run test:security`    | 60 réussis, 0 ignoré                                |
| `npm run test:resilience`  | 23 réussis, 0 ignoré                                |
| `npm run test:performance` | 2 réussis, 0 ignoré                                 |
| `npm run test:integration` | 6 réussis, 0 ignoré                                 |
| `npm run test:e2e:live`    | 2 réussis, 0 ignoré                                 |
| Compose hybride            | configuration valide, SearXNG et Crawl4AI `healthy` |

Les rapports sont écrits sous `.data/test-reports/`. Le workflow CI exécute les
suites sous Node 24, démarre les dépendances Compose pour l’intégration et publie
les rapports comme artefacts.

La recette d’intégration a révélé que Crawl4AI 0.9.0 bloque les URL `data:` avec
sa protection SSRF. L’adaptateur utilise désormais son transport natif `raw://`,
qui traite le HTML préparé sans requête réseau. Un test réel de `/crawl` protège
ce contrat en complément du test unitaire du payload.

## Livrables documentaires

- ADR-001 à ADR-010 : `docs/adr/` ;
- matrice : `docs/planning/traceabilite-v1.md` ;
- benchmark : `docs/planning/benchmark-v1-2026-06-22.md` ;
- versions : `docs/planning/versions-recette-v1.md` ;
- recette UI : `docs/planning/recette-intellij-v1.md`.

## Limites conservées

Le benchmark réel obtient 50 % de présence du domaine officiel attendu dans le
top 5 et 0 % de résultats datés avec les moteurs actifs. Ces valeurs n’annulent
pas l’exécution du benchmark, mais montrent que pertinence et fraîcheur doivent
encore être améliorées. Crawl4AI reste référencé par un tag ; un digest est
préférable avant une livraison immuable.

La phase 9 et la V1 complète ne doivent être déclarées terminées qu’après la
recette IntelliJ et l’archivage de sa preuve selon `recette-intellij-v1.md`.
