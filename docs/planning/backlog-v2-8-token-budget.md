# Backlog V2.8–V2.11 — Budget token Copilot

> **Statut au 2026-07-29** : implémenté, mesuré sur 100, 1 000 et 10 000 sections et qualifié
> localement sans skip sur le head V2.11.

## Objectif

Réduire la consommation de contexte Copilot sans perdre la qualité des réponses documentaires.

## Principe cible

Chercher d'abord avec `search_docs`, puis lire uniquement ce qui est nécessaire.

## Priorités

### P0 — Documentation usage économique — terminé

- Expliquer que `search_docs` est la surface principale pour Copilot.
- Recommander `maxResults: 3` pour une question ciblée.
- Recommander `maxResults: 5` pour une recherche exploratoire.
- Déconseiller la lecture globale de toutes les sections.

### P1 — Outil `read_doc_section` — terminé

Ajouter un outil MCP read-only qui lit une seule section par identifiant avec une limite de caractères.

### P1 — Outil `list_docs` — terminé

Ajouter un outil MCP read-only compact qui liste les documents sans contenu de section.

### P1 — Options compactes pour `search_docs` — terminé

Ajouter des options comme `maxSnippetChars` ou `compact` pour réduire encore la taille des réponses.

### P2 — Resources globales plus légères — terminé

Les collections retournent une page SQL stable de 20 éléments, exposent `nextOffset`/`nextUri` et
respectent un plafond sérialisé de 24 000 caractères. La lecture par identifiant est ciblée et une
section détaillée est bornée à 8 000 caractères.

### P3 — Benchmark de taille de réponse — terminé

Le runner `npm run benchmark:mcp:size` mesure texte sérialisé, JSON structuré, estimation tokens,
latences p50/p95, RSS du runner et taille SQLite. Sur 10 000 sections, la resource bornée mesure
15 636 caractères au p95 (~3 909 tokens), contre 4 733 639 (~1 183 410 tokens) pour la simulation
non bornée : réduction de 99,67 %.

Preuve :
[`benchmark-mcp-response-size-2026-07-29.json`](benchmark-results/benchmark-mcp-response-size-2026-07-29.json).

## Critères d'acceptation

- Copilot utilise `search_docs` en priorité.
- Une question normale fonctionne avec trois résultats.
- La lecture détaillée est ciblée.
- Les resources globales restent read-only mais sobres.
- Aucun outil mutable n'est ajouté.
- Les lectures par identifiant n'effectuent pas de chargement global O(N).
- Les filtres et la pagination sont exécutés en SQL avec un ordre stable par identifiant.
