# Benchmark V2 hybride — 2026-07-05

## Périmètre

- Catalogue testé : `.data/catalog-spike.db`.
- Requêtes : 5.

## Résultats

- Moyenne recherche lexicale : environ 216 ms.
- Moyenne recherche hybride : environ 79 ms.
- Recouvrement moyen top 5 : 0.64.

## Conclusion

La recherche hybride locale V2.7 reste optionnelle tant qu'un benchmark plus large ne confirme pas son gain et sa latence sur un corpus représentatif.
