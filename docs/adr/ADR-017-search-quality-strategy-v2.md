# ADR-017 — Choisir la stratégie de recherche V2 sur benchmark mesuré

- **Statut** : Proposé — décision finale après exécution du benchmark V2.13
- **Date** : 2026-07-29
- **Décisions liées** : ADR-010, ADR-015, ADR-016
- **Issue** : #16

## Contexte

La V2 utilise SQLite FTS5/BM25 comme moteur de recherche documentaire local. V2.7 a ajouté un
prototype appelé « semantic/hybrid », mais celui-ci n'utilise aucun embedding ni modèle appris : il
applique un feature hashing lexical à des tokens, stems légers et bigrammes, puis une similarité
cosine sur les candidats déjà récupérés par FTS.

Cette nomenclature sur-vendait donc la capacité technique. De plus, le benchmark historique ne
contenait que cinq requêtes et exécutait toujours la baseline avant le reranker, ce qui ne permettait
pas de conclure proprement sur la qualité ni la performance.

## Décision de méthode

V2.13 impose avant toute généralisation :

- 10 sources documentaires ;
- 100 documents ;
- 10 000 sections dans l'exécution de référence ;
- 50 requêtes annotées ;
- MRR@10, nDCG@10, Recall@10, Precision@5 et zero-result rate ;
- warm-up et ordre d'exécution alterné ;
- p50/p95/p99, mémoire, taille SQLite/FTS, rebuild et sync incrémentale.

Le corpus est un surrogate synthétique reproductible dérivé d'un manifest versionné représentant des
domaines de documentation officielle. Cette propriété garantit la répétabilité mais limite la portée
externe des conclusions ; un benchmark ultérieur sur contenu réel pourra compléter la preuve.

## Nomenclature adoptée immédiatement

Les noms suivants sont supprimés :

```text
LocalSemanticVectorizer
semanticScore
lexical-semantic-hybrid
```

Ils sont remplacés par :

```text
HashedLexicalVectorizer
rerankScore
combinedScore
fts5-hashed-lexical-rerank
```

Cette partie de la décision est indépendante des résultats du benchmark : elle décrit simplement la
technologie réellement utilisée.

## Seuils de décision

Baseline FTS5/BM25 :

```text
Recall@10 >= 0,85
MRR@10    >= 0,70
nDCG@10   >= 0,75
p95       <= 150 ms à 10 000 sections
```

Le reranker lexical local ne mérite d'être conservé que si :

```text
gain absolu Recall@10 ou nDCG@10 >= 0,02
p95 <= 150 ms
ratio p95 reranker / baseline <= 2,5
```

## Branches de décision

### A — FTS5/BM25 seul

Retenir la baseline si elle passe les seuils et que le reranker n'apporte pas le gain minimal.

### B — FTS5 + reranker lexical hashé

Retenir le reranker uniquement s'il améliore réellement la qualité dans le budget de latence.

### C — Étude d'embeddings locaux

Autoriser une étude distincte uniquement si la baseline manque un seuil et que le reranker lexical ne
ferme pas l'écart. Cette branche n'autorise pas automatiquement l'ajout d'embeddings au produit.

Aucune API commerciale obligatoire n'est autorisée par cet ADR.

## Résultat V2.13

À compléter avec le rapport exact-head :

```text
Rapport : docs/planning/benchmark-results/benchmark-v2-search-quality-2026-07-29.json
SHA testé : À COMPLÉTER
Décision : À COMPLÉTER
Recall@10 baseline : À COMPLÉTER
MRR@10 baseline : À COMPLÉTER
nDCG@10 baseline : À COMPLÉTER
p95 baseline : À COMPLÉTER
Gain reranker : À COMPLÉTER
p95 reranker : À COMPLÉTER
```

Le statut de cet ADR passe à **Accepté** uniquement après insertion de ces mesures et qualification du
SHA exact correspondant.

## Conséquences

- La recherche reste local-first et sans coût d'API obligatoire.
- La terminologie publique reflète la technologie réelle.
- Toute complexité supplémentaire doit être justifiée par une mesure reproductible.
- Les résultats V2.13 servent de baseline pour les évolutions futures de recherche.
