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

La recherche FTS5/BM25 reste la baseline et la surface de référence tant que le benchmark V2.13 ne
démontre pas qu'un reranker mérite sa complexité.

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
- 10 000 sections par défaut ;
- anglais et français ;
- 50 requêtes annotées dans 10 catégories ;
- MRR@10, nDCG@10, Recall@10, Precision@5 et zero-result rate ;
- warm-up contrôlé, ordre lexical/reranker alterné, répétitions, p50/p95/p99 ;
- RSS, taille SQLite/FTS, rebuild complet et sync incrémentale.

Les contenus du benchmark sont des **surrogates synthétiques** : les domaines et sujets sont
versionnés dans le manifest, mais aucun gros téléchargement de documentation tierce n'est committé.
Cette propriété rend le benchmark déterministe et reproductible ; elle doit rester explicite dans
l'interprétation des résultats.

## Règle de décision

Seuils de départ :

```text
Recall@10 >= 0,85
MRR@10    >= 0,70
nDCG@10   >= 0,75
p95       <= 150 ms à 10 000 sections
```

Le reranker local n'est conservé que s'il apporte au moins 0,02 de gain absolu sur Recall@10 ou
nDCG@10, reste sous le budget de 150 ms et ne dépasse pas 2,5× le p95 de la baseline.

Les embeddings locaux ne sont étudiés que si FTS5/BM25 manque un seuil et que le reranking lexical
ne ferme pas l'écart. Aucune API commerciale obligatoire n'est introduite.

## Limites volontaires

- Pas d'embeddings par défaut.
- Pas de stockage vectoriel durable.
- Pas de mutation du catalogue par la recherche.
- Pas d'exposition MCP mutable.
- Pas de conclusion d'architecture sans rapport de benchmark versionné.
