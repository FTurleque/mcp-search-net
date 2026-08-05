# Validation locale V2.8 — 2026-07-05

## Statut

- Branche : `feat/v2-catalog-storage`.
- PR : #8, conservée en draft.
- Merge : non effectué.
- Ready for Review : non effectué.
- GitHub Actions : non déclenchées.
- Décision : V2.8 validée localement sur la tranche documentation `search_docs`, benchmark lexical/hybride et backlog budget Copilot.

## Résultats validés

- `npm run format:check` : OK.
- `npm run lint` : OK.
- `npm run typecheck` : OK.
- `npm run build` : OK.
- `npm run test` : OK.
- Tests : 36 fichiers passés, 182 tests passés.
- `npm run benchmark:v2:hybrid -- --path .data/catalog-spike.db` : OK.

## Benchmark lexical/hybride

- Catalogue : `.data/catalog-spike.db`.
- Requêtes : 5.
- Moyenne lexicale : 217.48 ms.
- Moyenne hybride : 79.86 ms.
- Recouvrement top 5 moyen : 0.64.
- Rapport : `docs/planning/benchmark-results/benchmark-v2-hybrid-2026-07-05.json`.

## Conclusion

La tranche V2.8 est validée localement. La recherche hybride V2.7 reste optionnelle tant qu'un benchmark plus large ne confirme pas un gain durable.
