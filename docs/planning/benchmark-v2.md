# Benchmark V2 — FTS5/BM25 et qualité de recherche documentaire

## Statut

- **Phase** : V2.13 — exécution et décision d'architecture (#16).
- **Baseline** : SQLite FTS5 + BM25.
- **Candidat** : reranking lexical local par feature hashing, sans embeddings.
- **Principe** : aucune généralisation du reranker et aucun embedding par défaut avant mesure.

> V2.11 a déjà qualifié séparément la scalabilité SQL et le budget des réponses MCP sur 100, 1 000
> et 10 000 sections. V2.13 mesure ici la **qualité de recherche** et la latence de la baseline et du
> reranker sur un corpus déterministe.

## Objectif

Choisir objectivement entre :

1. conserver FTS5/BM25 seul ;
2. conserver le reranker lexical hashé s'il apporte un gain réel ;
3. étudier ultérieurement des embeddings locaux uniquement si les seuils lexicaux ne sont pas
   atteints.

Aucune API commerciale obligatoire ne fait partie de cette décision.

## Corpus reproductible

Manifest :

```text
benchmarks/v2-search-quality/corpus-manifest.json
```

Le manifest décrit 10 domaines de documentation officielle et 100 sujets documentaires : Node.js,
TypeScript, MDN anglais/français, GitHub Docs, JetBrains, Maven, OpenJDK, Docker et SQLite.

Le runner génère localement des surrogates synthétiques à partir de ce manifest. Aucun gros artefact
tiers n'est committé. Par défaut :

```text
10 sources
100 documents
100 sections / document
10 000 sections
2 langues : en, fr
```

Le caractère synthétique est volontaire : il garantit la reproductibilité, mais le rapport final doit
le rappeler comme limite de validité externe.

## Requêtes annotées

Jeu versionné :

```text
benchmarks/v2-search-quality/queries.json
```

Il contient exactement 50 requêtes avec jugements de pertinence 1..3, réparties sur :

- API exacte ;
- concepts ;
- configuration ;
- erreurs ;
- versions ;
- multi-document ;
- paraphrases ;
- filtres source/langue ;
- accents ;
- identifiants de code/API.

Chaque cas expose `id`, `category`, `query`, filtres éventuels et `judgments`.

## Métriques qualité

Le runner calcule au niveau document :

```text
MRR@10
nDCG@10
Recall@10
Precision@5
Zero-result rate
```

Les métriques sont également agrégées par catégorie. Les requêtes dont Recall@10 est inférieur à 1
pour au moins une stratégie sont listées explicitement dans `failures`.

## Métriques performance

Le protocole impose :

- warm-up avant mesure ;
- ordre baseline/reranker alterné selon requête et répétition ;
- 6 répétitions par défaut ;
- p50, p95, p99 et max ;
- RSS du processus ;
- taille `catalog.db` ;
- taille FTS via `dbstat` lorsqu'elle est disponible ;
- nombre de sections indexées ;
- rebuild FTS complet ;
- sync incrémentale réelle via `SyncCatalogDocuments` sur un document dédié.

Le benchmark n'utilise donc plus l'ordre fixe « lexical puis hybride » du spike V2.7.

## Commande

```bash
npm run benchmark:v2:search-quality
```

Options :

```text
--path <catalog.db>
--output <report.json>
--sections-per-document <n>
--repetitions <n>
--warmup-rounds <n>
```

Exécution de référence V2.13 :

```bash
npm run benchmark:v2:search-quality -- --sections-per-document 100 --repetitions 6 --warmup-rounds 2
```

Rapport attendu :

```text
docs/planning/benchmark-results/benchmark-v2-search-quality-YYYY-MM-DD.json
```

## Seuils initiaux

```text
Recall@10 >= 0,85
MRR@10    >= 0,70
nDCG@10   >= 0,75
p95       <= 150 ms sur 10 000 sections
```

Critère supplémentaire pour conserver le reranker :

```text
gain absolu Recall@10 ou nDCG@10 >= 0,02
p95 reranker <= 150 ms
ratio p95 reranker / baseline <= 2,5
```

Ces seuils sont explicites dans le rapport JSON pour que la décision soit reproductible.

## Décision automatisée

Le runner produit un objet `decision` :

### `fts5-bm25`

Choisi si la baseline atteint les seuils qualité et performance et que le reranker ne justifie pas sa
complexité.

### `fts5-plus-hashed-lexical-reranker`

Choisi si le reranker apporte le gain minimum tout en respectant le budget de latence.

### `evaluate-local-embeddings`

Choisi si FTS5/BM25 manque un seuil et que le reranker lexical ne ferme pas l'écart.

Cette troisième sortie autorise une **étude** d'embeddings locaux ; elle n'autorise pas leur ajout au
produit sans tranche dédiée et nouveau benchmark.

## Nomenclature V2.13

Le prototype V2.7 utilisait des noms trop ambitieux : `LocalSemanticVectorizer`, `semanticScore` et
`lexical-semantic-hybrid`.

V2.13 les remplace par :

```text
HashedLexicalVectorizer
rerankScore
combinedScore
fts5-hashed-lexical-rerank
```

Le vectorizer réalise uniquement tokens + stemming léger + bigrammes + feature hashing + cosine. Il
ne produit aucune représentation sémantique apprise.

## Preuve de scalabilité V2.11

Commande historique :

```bash
npm run benchmark:mcp:size
```

| Sections | Base SQLite | Page sections p95 | Simulation globale p95 | Réduction |
| -------- | ----------- | ----------------- | ---------------------- | --------- |
| 100      | 212 992 o   | 15 634 caractères | 45 955 caractères      | 65,98 %   |
| 1 000    | 851 968 o   | 15 635 caractères | 465 597 caractères     | 96,642 %  |
| 10 000   | 6 971 392 o | 15 636 caractères | 4 733 639 caractères   | 99,67 %   |

À 10 000 sections, la page bornée représentait environ 3 909 tokens au p95 et répondait en 1,738 ms
au p95. Cette preuve porte sur le budget contexte et ne remplace pas V2.13.

Rapport V2.11 :
[`benchmark-mcp-response-size-2026-07-29.json`](benchmark-results/benchmark-mcp-response-size-2026-07-29.json).

## Gates de non-régression V2.13

Après génération du rapport représentatif :

```bash
npm run check
npm run test:required
npm run test:unit
npm run test:contract
npm run test:security
npm run test:resilience
npm run test:performance
npm run test:integration
npm run test:e2e:deterministic
```

Les tests live SearXNG/Crawl4AI restent hors du gate spécifique V2.13 et seront rejoués dans la
qualification finale #18.

## Définition de terminé

V2.13 est terminée lorsque :

- le corpus et les 50 jugements sont versionnés ;
- le rapport 10 000 sections est produit sur un SHA exact ;
- les métriques qualité/performance et échecs par catégorie sont archivés ;
- la décision du runner est relue et inscrite dans ADR-017 ;
- la documentation n'appelle plus le feature hashing « sémantique » ;
- les gates exact-head passent sans skip ;
- la PR focalisée est mergée dans `feat/v2-catalog-storage`.
