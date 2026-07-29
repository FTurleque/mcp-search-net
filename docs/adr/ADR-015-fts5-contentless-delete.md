# ADR-015 — Utiliser FTS5 `contentless-delete` comme index dérivé

- **Statut** : Accepté, implémentation réconciliée en V2.9
- **Date** : 2026-07-03
- **Réconciliation** : 2026-07-29
- **Décision liée** : ADR-010, ADR-014

## Contexte

La V2 doit fournir une recherche documentaire locale, multi-document, rapide et reproductible.

L'ADR-010 retient SQLite FTS5 et BM25 comme premier socle lexical. Les embeddings ne sont envisagés qu'après benchmark.

Le catalogue V2 conserve les contenus métier dans `document_sections`. L'index plein texte doit rester dérivé et reconstructible.

## Décision

La V2 utilisera un index FTS5 `contentless-delete` dans la base `catalog.db`.

Table effective depuis la migration corrective immuable `C007` :

```sql
CREATE VIRTUAL TABLE document_section_fts USING fts5(
  section_id UNINDEXED,
  document_id UNINDEXED,
  source_key UNINDEXED,
  language UNINDEXED,
  title,
  heading,
  heading_path,
  content,
  content = '',
  contentless_delete = 1,
  tokenize = 'unicode61 remove_diacritics 2'
);
```

Le texte métier reste dans `document_sections`. L'index FTS5 n'est pas une source de vérité.

La correspondance est exclusivement `document_section_fts.rowid = document_sections.id`. Une
table contentless ne restitue pas les colonnes applicatives ; les recherches et vérifications
rejoignent donc la table métier par `rowid`.

## Réconciliation C006 / C007

`C006__create_document_section_fts.sql` a créé historiquement une table FTS5 classique alors que
cette ADR retenait déjà `contentless-delete`. C006 reste immuable. La correction est portée par
`C007__harden_revision_integrity.sql`, qui recrée l'index selon cette décision et le reconstruit à
partir des sections courantes. Le runner conserve un SHA-256 normalisé de chaque migration et
refuse toute dérive ultérieure d'une version appliquée.

## Justification

`contentless-delete` permet de garder l'index compact et dérivé tout en autorisant des opérations d'update/delete plus pratiques qu'une table contentless historique.

Cette stratégie évite de coupler fortement `document_sections` à une table FTS5 `external content`, dont la cohérence applicative peut être plus délicate.

## Ranking initial

L'implémentation V2.9 utilise BM25 FTS5, puis un ordre stable par titre et ordinal. Les poids
suivants restent des candidats de benchmark, pas un contrat actuel :

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
4. retourner le nombre de sections indexées.

`verify` doit contrôler :

- nombre de sections ;
- nombre d'entrées FTS ;
- absence de sections courantes non indexées ;
- absence d'entrées FTS orphelines ;
- `PRAGMA integrity_check` et `PRAGMA foreign_key_check` ;
- documents actifs sans version courante ;
- pointeurs courants invalides ou versions courantes sans section.

## Atomicité

`CatalogRepository.commitDocumentRevision` écrit dans une transaction SQLite unique le document,
la version, les sections et l'index dérivé, puis bascule `documents.current_version_id` en dernier.
Une erreur de section ou d'indexation annule l'ensemble de la révision et restaure aussi l'ancien
FTS. Les mises à jour de statut ou de métadonnées d'un document réindexent ou désindexent sa
version courante dans la même transaction.

La relation cyclique `documents.current_version_id -> document_versions` n'est pas matérialisée
par une FK ajoutée rétroactivement : C007 installe des triggers qui refusent un pointeur vers une
version absente ou appartenant à un autre document, ainsi que la suppression ou le déplacement
d'une version pointée. `catalog verify` contrôle en plus la cohérence avec `is_current`.

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
