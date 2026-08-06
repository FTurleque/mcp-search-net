# ADR-018 — Évaluer les embeddings locaux sans les intégrer avant preuve

- **Statut** : Accepté — prototype vectoriel local autorisé, adoption runtime immédiate refusée
- **Date** : 2026-08-06
- **Décisions liées** : ADR-015, ADR-016, ADR-017
- **Issue** : #32

## Contexte

ADR-017 conserve FTS5/BM25 comme baseline produit : la recherche exacte, les identifiants, les
configurations et les API sont bonnes et très rapides, tandis que les paraphrases et questions
multi-document restent les principales faiblesses. Le reranker lexical hashé historique n'a fourni
aucun gain mesuré.

L'étude autorisée par ADR-017 devait répondre à une question précise : un modèle **local**, sans API
commerciale obligatoire et redistribuable, améliore-t-il assez le rappel sémantique pour justifier
le coût d'un index vectoriel local ?

## Méthode

Le benchmark #32 reste séparé du runtime produit. Il :

- utilise un corpus reproductible de 10 sources / 100 documents / 10 000 sections ;
- porte le jeu à 60 requêtes, dont dix paraphrases et dix requêtes multi-document ;
- exécute d'abord le benchmark Node/SQLite actuel afin de conserver une baseline produit exacte ;
- compare une baseline lexicale, des embeddings statiques locaux et une fusion Reciprocal Rank
  Fusion ;
- mesure MRR@10, nDCG@10, Recall@10, Precision@5 et zero-result rate globalement et par catégorie ;
- mesure p50/p95/p99/max, mémoire RSS, taille du snapshot modèle, taille de l'index en mémoire, temps
  de construction et coût d'un lot incrémental ;
- enregistre le modèle, sa révision, sa licence et la dimension des vecteurs.

Le candidat évalué est `minishlab/potion-multilingual-128M`. Ni Python, ni `model2vec`, ni le modèle,
ni un moteur vectoriel ne deviennent une dépendance du runtime `mcp-search-net` par cette ADR.

## Gates

Un résultat peut uniquement autoriser un **prototype produit séparé** si :

```text
gain absolu Recall@10 ou nDCG@10 >= 0,02
ET
(gain Recall paraphrase >= 0,10 OU gain Recall multi-document >= 0,10)
ET
p95 fusion <= 150 ms à environ 10 000 sections
```

Même si ces gates passent, l'intégration runtime reste `NON` tant qu'un prototype ne prouve pas en
plus :

- persistance et reconstruction de l'index ;
- comportement de sync incrémentale ;
- packaging Windows et Docker ;
- licence et redistribution du modèle ;
- fonctionnement hors ligne après installation ;
- absence de régression majeure sur exact-api, identifiants et configuration ;
- budget mémoire acceptable sur une machine développeur.

## Résultats officiels

Le workflow de benchmark a été exécuté sur le SHA
`72b65a12786081d4e1fbc795fd8764dd4c81fd51`, run `31124100736`, le 6 août 2026. Le corpus contient
10 sources, 100 documents, 10 000 sections et 60 requêtes.

| Méthode                               | Recall@10 | MRR@10 | nDCG@10 | Precision@5 |
| ------------------------------------- | --------: | -----: | ------: | ----------: |
| FTS5/BM25 lexical                     |    0.6167 | 0.6167 |  0.6167 |      0.1233 |
| Embeddings `potion-multilingual-128M` |    0.8528 | 0.9500 |  0.8724 |           — |
| Fusion RRF                            |    0.8528 |      — |       — |           — |

Résultats ciblés :

- Paraphrase Recall@10 : `0` lexical → `0.70` embeddings/fusion ;
- Multi-document Recall@10 : `0` lexical → `0.4167` embeddings/fusion ;
- embeddings p95 : `2.756 ms` ;
- fusion RRF p95 : `28.216 ms` ;
- gain sémantique global documenté : `+0.2557`.

Les gates du prototype sont donc satisfaits : le gain de qualité dépasse largement `0.02`, les
catégories paraphrase et multi-document progressent au-delà des seuils, et la fusion reste très en
dessous du plafond de `150 ms`.

La seule différence ultérieure entre le SHA benchmarké et le head fonctionnel qualifié de la PR #37
`cbc9b58d0c948da2ed840a8245c3aafa494e67b7` est l'assertion du manifeste de test (`50` → `60`). Le
script, le corpus et le workflow benchmark sont inchangés ; les résultats sont donc applicables au
head qualifié de #37.

## Décision

La recommandation officielle est :

```text
recommendation: prototype-local-vector-index
adoptEmbeddingRuntimeNow: false
```

Un **prototype produit séparé** d'index vectoriel local est autorisé. Il devra démontrer les critères
runtime listés ci-dessus avant qu'une nouvelle ADR puisse proposer son intégration.

Le runtime courant reste FTS5/BM25. Aucune dépendance Python, modèle, index vectoriel ou nouvelle
surface MCP n'est ajoutée par cette décision.

Le workflow GitHub Actions one-shot utilisé pour produire la mesure était lié à la branche de
remédiation `agent/full-audit-remediation`. Une fois l'étude #32 terminée, ce workflow n'a plus de
rôle CI pérenne et doit être retiré. Le harness de recherche `scripts/benchmark-local-embeddings.py`
reste disponible pour une future expérimentation explicitement déclenchée dans le cadre du
prototype.

## Conséquences

- FTS5/BM25 reste la stratégie de recherche du produit livré.
- Le résultat #32 justifie un prototype vectoriel local, pas une adoption runtime immédiate.
- Toute intégration future exige une nouvelle preuve exact-head et une décision d'architecture
  explicite couvrant persistance, packaging, licence, offline et mémoire.
- Le benchmark de recherche peut rester un outil research-only sans alourdir l'installation du
  serveur.
- L'issue #32 est terminée avec la décision `prototype-local-vector-index`.
