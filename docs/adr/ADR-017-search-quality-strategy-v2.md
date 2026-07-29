# ADR-017 — Choisir la stratégie de recherche V2 sur benchmark mesuré

- **Statut** : Accepté
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

## Résultat V2.13 final

Qualification Windows PowerShell du 29 juillet 2026 sur Node.js 24.17.0 :

```text
Rapport versionné : docs/planning/benchmark-results/benchmark-v2-search-quality-2026-07-29.json
Preuve finale : docs/planning/validation-v2-13-search-quality-2026-07-29.md
SHA fonctionnel qualifié exact : aeb49b1f6a7f035779e726a9db641710f172819f
Merge #24 : c9ba09345cebb1a9f9dfa63f98e0352c33dcefd2
Corpus : 10 sources / 100 documents / 10 000 sections / 50 requêtes / en + fr
Décision : evaluate-local-embeddings

FTS5/BM25
MRR@10        0,74  PASS seuil 0,70
nDCG@10       0,74  FAIL seuil 0,75
Recall@10     0,74  FAIL seuil 0,85
Precision@5   0,148
zero-result   0,26
p50           0,792 ms
p95           17,246 ms  PASS seuil 150 ms
p99           21,211 ms

Reranker lexical hashé
MRR@10        0,74
nDCG@10       0,74
Recall@10     0,74
Precision@5   0,148
zero-result   0,26
p50           3,623 ms
p95           17,939 ms
p99           21,234 ms
Gain qualité  0
Ratio p95     1,0402
```

La baseline est très largement dans le budget de latence mais manque les seuils Recall@10 et nDCG@10.
Le reranker lexical hashé ne modifie aucune métrique qualité et n'atteint donc pas le gain minimal de
0,02. Il n'est pas retenu comme stratégie produit.

Les deux catégories les plus faibles sont `paraphrase` et `multi-document` : chacune affiche un
zero-result rate de 1,00 sur les cinq requêtes du jeu. Les catégories API exacte, configuration,
filtres, accents, identifiants et versions atteignent Recall@10 = 1,00 sur ce corpus. Ces écarts
montrent que le problème mesuré est principalement un problème de rappel lexical, pas de latence.

La décision V2.13 est donc :

1. conserver FTS5/BM25 comme baseline opérationnelle actuelle ;
2. ne pas généraliser le reranker lexical hashé, car son gain mesuré est nul ;
3. autoriser une tranche d'étude séparée sur des embeddings **locaux** pour les paraphrases et le
   rappel multi-document ;
4. ne pas intégrer d'embeddings au produit sans benchmark comparatif dédié sur corpus réel ou plus
   représentatif ;
5. ne pas introduire d'API commerciale obligatoire.

Le corpus V2.13 étant synthétique, cette décision autorise une étude et fixe une baseline mesurée ;
elle ne constitue pas une preuve de qualité externe sur l'ensemble des documentations réelles.

Le merge de #24 a été effectué avec une garde sur le SHA qualifié. La comparaison GitHub entre
`aeb49b1f6a7f035779e726a9db641710f172819f` et
`c9ba09345cebb1a9f9dfa63f98e0352c33dcefd2` retourne `files: []` : aucun changement de contenu n'a
été introduit par le commit de merge.

## Conséquences

- La recherche reste local-first et sans coût d'API obligatoire.
- La terminologie publique reflète la technologie réelle.
- Le reranker lexical hashé reste une expérience mesurée, non une capacité « sémantique » à
  généraliser.
- FTS5/BM25 reste le moteur actuel tant qu'une alternative locale n'a pas démontré un meilleur rappel
  avec un coût acceptable.
- Une étude d'embeddings locaux est désormais justifiée, mais son intégration nécessite une tranche et
  une décision distinctes.
- Toute complexité supplémentaire doit être justifiée par une mesure reproductible.
- Les résultats V2.13 servent de baseline pour les évolutions futures de recherche.
