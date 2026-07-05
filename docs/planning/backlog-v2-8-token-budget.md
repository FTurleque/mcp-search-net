# Backlog V2.8 — Budget token Copilot

## Objectif

Réduire la consommation de contexte Copilot sans perdre la qualité des réponses documentaires.

## Principe cible

Chercher d'abord avec `search_docs`, puis lire uniquement ce qui est nécessaire.

## Priorités

### P0 — Documentation usage économique

- Expliquer que `search_docs` est la surface principale pour Copilot.
- Recommander `maxResults: 3` pour une question ciblée.
- Recommander `maxResults: 5` pour une recherche exploratoire.
- Déconseiller la lecture globale de toutes les sections.

### P1 — Outil `read_doc_section`

Ajouter un outil MCP read-only qui lit une seule section par identifiant avec une limite de caractères.

### P1 — Outil `list_docs`

Ajouter un outil MCP read-only compact qui liste les documents sans contenu de section.

### P1 — Options compactes pour `search_docs`

Ajouter des options comme `maxSnippetChars` ou `compact` pour réduire encore la taille des réponses.

### P2 — Resources globales plus légères

Éviter que les resources globales retournent du contenu complet par défaut.

### P3 — Benchmark de taille de réponse

Mesurer la taille texte et JSON des réponses MCP pour estimer la consommation de contexte.

## Critères d'acceptation

- Copilot utilise `search_docs` en priorité.
- Une question normale fonctionne avec trois résultats.
- La lecture détaillée est ciblée.
- Les resources globales restent read-only mais sobres.
- Aucun outil mutable n'est ajouté.
