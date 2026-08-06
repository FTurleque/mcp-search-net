# Recherche documentaire V2.13 — FTS5 et reranking lexical local

> Le nom de fichier est conservé temporairement pour les liens historiques V2.7. Le prototype n'est
> **pas** une recherche sémantique : il n'utilise ni embedding, ni modèle appris, ni base vectorielle.

## Statut

V2.13 remplace la nomenclature expérimentale « semantic/hybrid » par une description fidèle de la
technologie :

- recherche de candidats : SQLite FTS5 avec classement BM25 ;
- signal lexical secondaire : feature hashing déterministe de tokens, stems légers et bigrammes ;
- similarité : cosine sur le vecteur hashé local ;
- reranking : combinaison du score lexical exposé par le repository et du score hashé local.

Le benchmark V2.13 du 29 juillet 2026 montre que le reranker lexical hashé n'améliore aucune métrique
qualité sur le corpus de référence. FTS5/BM25 reste donc la baseline opérationnelle. Une étude séparée
d'embeddings locaux a ensuite été menée dans #32 ; son résultat postérieur est réconcilié dans la
section [Décision postérieure — benchmark embeddings #32](#décision-postérieure--benchmark-embeddings-32).

## Commande expérimentale

```bash
npm run catalog:reranked-search -- --path .data/catalog.db --query "texte recherché"
```

Options :

```text
--query <text>
--path <catalog.db>
--source-key <key>
--language <language>
--limit <n>
--candidate-limit <n>
```

Cette commande reste expérimentale. Le benchmark V2.13 ne justifie pas sa généralisation comme
stratégie de recherche par défaut.

## Contrat

La sortie JSON indique :

- `schemaVersion = 2.0` ;
- `strategy = fts5-hashed-lexical-rerank` ;
- `lexicalScore` : signal lexical normalisé exposé par les candidats FTS ;
- `rerankScore` : cosine des features lexicales hashées ;
- `combinedScore` : combinaison locale utilisée uniquement pour réordonner les candidats.

Les anciens champs `semanticScore` et la stratégie `lexical-semantic-hybrid` ont été supprimés afin
de ne pas présenter du feature hashing lexical comme une capacité sémantique.

## Ce que fait `HashedLexicalVectorizer`

Le vectorizer :

1. normalise les diacritiques et la casse ;
2. tokenize le texte ;
3. retire une petite liste de stop words français/anglais ;
4. ajoute tokens, stems légers et bigrammes à un espace hashé fixe ;
5. normalise le vecteur ;
6. compare deux textes par cosine.

Ce mécanisme peut rapprocher des variantes lexicales, mais **ne comprend pas le sens** et ne crée pas
de représentation sémantique apprise.

## Benchmark V2.13

Commande :

```bash
npm run benchmark:v2:search-quality
```

Le protocole versionné utilise :

- 10 domaines de documentation officielle ;
- 100 documents synthétiques reproductibles dérivés du manifest ;
- 10 000 sections ;
- anglais et français ;
- 50 requêtes annotées dans 10 catégories ;
- MRR@10, nDCG@10, Recall@10, Precision@5 et zero-result rate ;
- warm-up contrôlé, ordre lexical/reranker alterné, 6 répétitions, p50/p95/p99 ;
- RSS, taille SQLite/FTS, rebuild complet et sync incrémentale.

Rapport :

```text
docs/planning/benchmark-results/benchmark-v2-search-quality-2026-07-29.json
```

SHA benchmarké :

```text
be738b1c0fc9c9fa04beb06a5699753cbfa2ff9c
```

Résultats principaux :

| Mesure           | FTS5/BM25 | Reranker lexical hashé |
| ---------------- | --------: | ---------------------: |
| MRR@10           |      0,74 |                   0,74 |
| nDCG@10          |      0,74 |                   0,74 |
| Recall@10        |      0,74 |                   0,74 |
| Precision@5      |     0,148 |                  0,148 |
| Zero-result rate |      0,26 |                   0,26 |
| p95              | 17,572 ms |              17,720 ms |

Le gain qualité du reranker est nul. Son ratio p95 par rapport à la baseline vaut 1,0084.

Les catégories `paraphrase` et `multi-document` affichent chacune un zero-result rate de 1,00. Les
catégories API exacte, configuration, filtres, accents, identifiants et versions atteignent Recall@10 =
1,00 sur ce corpus. Le principal déficit mesuré concerne donc le rappel lexical, pas la performance.

Les contenus du benchmark sont des **surrogates synthétiques** : les domaines et sujets sont
versionnés dans le manifest, mais aucun gros téléchargement de documentation tierce n'est committé.
Cette propriété rend le benchmark déterministe et reproductible, mais limite la validité externe des
résultats ; une alternative devra être revalidée sur corpus réel ou plus représentatif avant adoption.

## Décision V2.13

Seuils de départ :

```text
Recall@10 >= 0,85
MRR@10    >= 0,70
nDCG@10   >= 0,75
p95       <= 150 ms à 10 000 sections
```

La baseline passe MRR@10 et la latence, mais manque Recall@10 et nDCG@10. Le reranker lexical ne
ferme aucun écart et n'atteint pas le gain minimal de 0,02.

Décision historique V2.13 :

- conserver FTS5/BM25 comme baseline opérationnelle actuelle ;
- ne pas généraliser le reranker lexical hashé ;
- autoriser une étude distincte d'embeddings locaux pour les paraphrases et le rappel multi-document ;
- ne pas ajouter d'embeddings au produit sans tranche dédiée et benchmark comparatif ;
- ne pas introduire d'API commerciale obligatoire.

## Décision postérieure — benchmark embeddings #32

L'étude autorisée par V2.13 est terminée. Le run `31124100736` sur le SHA
`72b65a12786081d4e1fbc795fd8764dd4c81fd51` a comparé FTS5/BM25, les embeddings locaux
`minishlab/potion-multilingual-128M` et une fusion RRF sur 60 requêtes / 10 000 sections.

Résultats déterminants :

- Recall@10 : `0.6167` lexical → `0.8528` embeddings ;
- nDCG@10 : `0.6167` lexical → `0.8724` embeddings ;
- Paraphrase Recall@10 : `0` → `0.70` ;
- Multi-document Recall@10 : `0` → `0.4167` ;
- p95 embeddings : `2.756 ms` ; fusion RRF : `28.216 ms`.

La décision ADR-018 est :

```text
recommendation: prototype-local-vector-index
adoptEmbeddingRuntimeNow: false
```

Le prototype vectoriel local est donc autorisé comme chantier séparé. Le runtime livré reste
FTS5/BM25 ; aucune dépendance Python, modèle ou base vectorielle n'est ajoutée automatiquement.

## Limites volontaires

- Pas d'embeddings par défaut dans le runtime courant.
- Pas de stockage vectoriel durable avant prototype qualifié.
- Pas de mutation du catalogue par la recherche.
- Pas d'exposition MCP mutable.
- Pas de généralisation du reranker lexical hashé après un gain mesuré nul.
- Pas d'intégration vectorielle sans nouvelle qualification produit couvrant persistance, packaging,
  offline, licence et mémoire.
