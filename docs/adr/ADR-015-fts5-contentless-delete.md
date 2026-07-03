# ADR-015 — Utiliser FTS5 `contentless-delete` comme index dérivé

- **Statut** : Accepté pour V2.0
- **Date** : 2026-07-03
- **Décision liée** : ADR-010, ADR-014

## Contexte

La V2 doit fournir une recherche documentaire locale, multi-document, rapide et reproductible.

L'ADR-010 retient SQLite FTS5 et BM25 comme premier socle lexical. Les embeddings ne sont envisagés qu'après benchmark.

Le catalogue V2 conserve les contenus métier dans `document_sections`. L'index plein texte doit rester dérivé et reconstructible.

## Décision

La V2 utilisera un index FTS5 `contentless-delete` dans la base `catalog.db`.

Table cible indicative :

```sql
CREATE VIRTUAL TABLE document_sections_fts USING fts5(
  title,
  heading,
  body,
  code,
  content = '',
  contentless_delete = 1,
  tokenize = 'unicode61'
);
```

Le texte métier reste dans `document_sections`. L'index FTS5 n'est pas une source de vérité.

## Justification

`contentless-delete` permet de garder l'index compact et dérivé tout en autorisant des opérations d'update/delete plus pratiques qu'une table contentless historique.

Cette stratégie évite de coupler fortement `document_sections` à une table FTS5 `external content`, dont la cohérence applicative peut être plus délicate.

## Ranking initial

Colonnes et poids à benchmarker :

```text
title   = 8
heading = 5
code    = 3
body    = 1
```

La recherche utilise d'abord un score BM25 lexical. Les pondérations ne sont pas gelées tant que le benchmark V2 n'est pas exécuté.

## Rebuild et maintenance

La V2 doit fournir :

```text
mcp-search-net catalog rebuild-index
mcp-search-net catalog verify
```

`rebuild-index` doit :

1. vider l'index FTS5 ;
2. relire les sections courantes ;
3. réinsérer les lignes FTS ;
4. vérifier le nombre de sections indexées ;
5. produire un rapport de cohérence.

`verify` doit contrôler :

- nombre de sections ;
- nombre d'entrées FTS ;
- absence de sections courantes non indexées ;
- absence d'entrées FTS orphelines ;
- intégrité SQLite.

## Requêtes

Les entrées utilisateur doivent être transformées en requêtes FTS sûres :

- pas de concaténation SQL ;
- requêtes préparées ;
- échappement ou tokenisation contrôlée ;
- rejet des requêtes vides ;
- limite de longueur ;
- timeout applicatif ;
- budget de résultats.

## Non-décisions

Cette ADR ne décide pas :

- des embeddings ;
- d'un moteur externe comme Meilisearch ou OpenSearch ;
- du nom final de l'outil MCP V2 ;
- du format exact des snippets.

## Conséquences

### Positives

- Index local sans service externe.
- Reconstructible à partir du catalogue.
- Compatible avec la stratégie local-first.
- Suffisant pour une première V2 sans embeddings.

### Négatives

- Recherche sémantique non couverte.
- La qualité dépendra des pondérations et du découpage en sections.
- Besoin d'un benchmark sérieux.

### Neutralisation

- Créer `docs/planning/benchmark-v2.md`.
- Mesurer MRR@10, nDCG@10, Recall@10 et p95.
- Garder les embeddings en phase optionnelle uniquement.
