# Benchmark V2 — FTS5/BM25 et recherche documentaire

## Statut

- **Phase** : V2.0 — étude et cadrage
- **Portée** : définition du benchmark, aucune exécution obligatoire dans V2.0
- **Décision liée** : ADR-010, ADR-015

## Objectif

Évaluer objectivement la qualité et la performance de la recherche documentaire V2 avant d'introduire des optimisations lourdes ou des embeddings.

La V2 démarre avec un socle lexical local : SQLite FTS5 + BM25.

Les embeddings restent hors périmètre tant qu'un benchmark ne démontre pas un gain mesurable.

## Corpus initial

Cible minimale :

```text
10 sources officielles
100 documents minimum
1 000 à 10 000 sections
50 requêtes annotées
```

Sources candidates :

| Source                | Type            | Langue | Usage                   |
| --------------------- | --------------- | ------ | ----------------------- |
| Node.js docs          | API runtime     | en     | API, erreurs, options   |
| TypeScript handbook   | langage         | en     | concepts, config        |
| MDN                   | Web/API         | en/fr  | APIs navigateur         |
| GitHub Docs           | plateforme      | en     | Actions, Copilot, API   |
| JetBrains Docs        | IDE             | en     | IntelliJ, configuration |
| Maven Docs            | build Java      | en     | lifecycle, plugins      |
| Java/OpenJDK Docs     | langage/runtime | en     | classes, modules        |
| Docker Docs           | infra           | en     | compose, images         |
| SQLite Docs           | base locale     | en     | FTS5, SQL               |
| SearXNG/Crawl4AI docs | providers       | en     | exploitation MCP        |

Le corpus doit rester local, reproductible et versionné au niveau de ses manifests. Les contenus téléchargés peuvent rester hors Git si leur taille est importante.

## Requêtes annotées

Créer au moins 50 requêtes réparties par type :

| Type           | Exemple                                 | Objectif                  |
| -------------- | --------------------------------------- | ------------------------- |
| API exacte     | `fs.readFile options`                   | retrouver une API précise |
| Concept        | `typescript narrowing`                  | retrouver une explication |
| Configuration  | `github actions cache npm`              | retrouver une option      |
| Erreur         | `docker compose service_healthy`        | retrouver une cause       |
| Version        | `node 24 permission model`              | filtrer version/source    |
| Multi-document | `sqlite fts5 bm25 rank`                 | croiser sections          |
| Paraphrase     | `how to avoid stdout logs in mcp stdio` | robustesse lexicale       |
| Filtre source  | `source:github actions checkout`        | tester filtres            |

Chaque requête doit avoir :

```text
query
expected_document_ids
expected_section_ids
relevance_grade 0..3
notes
```

## Métriques

Métriques qualité :

```text
MRR@10
nDCG@10
Recall@10
Precision@5
Zero-result rate
```

Métriques performance :

```text
latence p50
latence p95
latence max
nombre sections scannées
taille catalog.db
taille index FTS
rebuild complet
sync incrémentale
```

## Seuils initiaux proposés

```text
Recall@10 >= 0.85
MRR@10 >= 0.70
nDCG@10 >= 0.75
p95 <= 150 ms sur 10 000 sections
rebuild complet reproductible
0 régression V1
```

Ces seuils sont indicatifs pour la V2.1/V2.2 et pourront être ajustés après première mesure.

## Scénarios à benchmarker

### Baseline FTS5 simple

- tokenizer `unicode61` ;
- colonnes `title`, `heading`, `body`, `code` ;
- `ORDER BY rank` ;
- pas de boost custom hors poids colonnes.

### Pondération BM25

Pondérations candidates :

```text
title   = 8
heading = 5
code    = 3
body    = 1
```

Comparer avec :

```text
title   = 10
heading = 6
code    = 2
body    = 1
```

et :

```text
title   = 5
heading = 3
code    = 2
body    = 1
```

### Filtres

Mesurer l'impact des filtres :

```text
sourceIds
documentIds
versionPolicy
language
publishedAfter
```

### Snippets

Comparer :

- extrait brut FTS ;
- extrait basé sur section complète ;
- extrait centré sur match.

## Rapport attendu

Créer un rapport par exécution :

```text
docs/planning/benchmark-results/benchmark-v2-YYYY-MM-DD.md
```

Contenu :

- commit testé ;
- taille corpus ;
- version SQLite ;
- configuration FTS ;
- résultats qualité ;
- résultats performance ;
- requêtes en échec ;
- recommandations.

## Règle embeddings

Les embeddings ne peuvent être étudiés que si l'une des conditions est vraie :

1. Recall@10 lexical < 0.85 malgré réglages raisonnables ;
2. les requêtes paraphrasées échouent massivement ;
3. un prototype local améliore Recall@10 ou nDCG@10 d'au moins 15 % ;
4. la latence p95 reste acceptable.

Aucune API payante obligatoire ne doit être introduite.

## Tests de non-régression

Chaque benchmark V2 doit aussi lancer :

```bash
npm run check
npm run test:e2e:deterministic
```

À partir de la phase d'implémentation MCP V2 :

```bash
npm run test:e2e
```

## Sortie attendue avant implémentation V2.2

- corpus défini ;
- 50 requêtes annotées ;
- script de benchmark conçu ;
- seuils validés ;
- décision de rester lexical en V2 initiale confirmée.
