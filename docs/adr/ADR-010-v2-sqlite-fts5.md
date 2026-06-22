# ADR-010 — Préparer la V2 avec SQLite FTS5

- Statut : Accepté pour préparation, non implémenté en V1
- Date : 22 juin 2026

## Contexte

Une future V2 pourra gérer un catalogue, des versions, la fraîcheur et une recherche multi-document.

## Décision

Prévoir SQLite FTS5 et BM25 comme premier socle lexical V2. Les embeddings ne seront considérés qu'après un benchmark démontrant un gain.

## Conséquences

La V1 conserve seulement son cache et n'introduit aucune table FTS, index permanent ou outil documentaire. La V2 utilisera un stockage ou des migrations clairement séparés.
