# Statut V2.7

La tranche V2.7 est lancée côté code.

Périmètre livré :

- vectorisation locale déterministe ;
- recherche hybride lexicale et sémantique ;
- aucun service externe ;
- aucune API payante ;
- script npm `catalog:hybrid-search` ;
- CLI `catalog-hybrid-search` ;
- test applicatif du reranking hybride.

Validation locale communiquée avant correctif CLI :

- format OK ;
- lint OK ;
- typecheck OK ;
- build OK ;
- tests OK ;
- 36 fichiers de tests passés ;
- 182 tests passés ;
- recherche hybride OK sur le catalogue de spike ;
- 10 résultats retournés ;
- stratégie `lexical-semantic-hybrid`.

Correctif appliqué après cette validation :

- normalisation des `^` parasites observés dans la valeur `query` sous Windows/npm.

Décision : V2.7 est validée localement avant correctif CLI mineur. Une revalidation courte est nécessaire sur le head courant.

Validation courte à relancer :

- lint ;
- typecheck ;
- build ;
- tests ;
- recherche hybride sur le catalogue de spike.

La PR #8 reste en draft et non mergée.
