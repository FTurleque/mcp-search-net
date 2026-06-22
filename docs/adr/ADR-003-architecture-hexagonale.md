# ADR-003 — Retenir une architecture hexagonale simplifiée

- Statut : Accepté
- Date : 22 juin 2026

## Contexte

SearXNG, Crawl4AI, SQLite et MCP doivent rester remplaçables et testables sans réseau.

## Décision

Séparer domaine, application/ports, infrastructure, présentation MCP et bootstrap. Les dépendances pointent vers l'intérieur et les handlers ne portent aucune logique métier.

## Conséquences

Les tests substituent les ports et les changements techniques restent localisés. Cette séparation ajoute quelques interfaces, jugées acceptables pour la sécurité et la maintenabilité.
