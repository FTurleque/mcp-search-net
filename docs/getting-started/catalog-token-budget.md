# Catalogue V2.11 — usage sobre avec Copilot

## Objectif

Réduire la consommation de contexte Copilot sans perdre la qualité des réponses documentaires.

## Workflow recommandé

```text
search_docs -> read_doc_section
```

1. Utiliser `search_docs` pour trouver les sections utiles.
2. Limiter `maxResults` à 3 pour une question ciblée.
3. Utiliser `compact` ou `maxSnippetChars` pour réduire les extraits.
4. Lire seulement la section retenue avec `read_doc_section`.

## Outils

### `search_docs`

Recherche dans le catalogue local et retourne une liste courte de résultats.

Options utiles :

```json
{
  "query": "synchronisation V2",
  "maxResults": 3,
  "compact": true,
  "maxSnippetChars": 160
}
```

### `list_docs`

Liste les documents sans contenu de section. La requête est paginée côté SQL et peut filtrer par
`sourceKey`, `language` et `status`.

```json
{
  "language": "fr",
  "status": "ACTIVE",
  "limit": 20,
  "offset": 0
}
```

La limite maximale est de 50 documents. La réponse expose `total`, `nextOffset` et `truncated` et
applique aussi un budget de 20 000 caractères à `data`.

### `read_doc_section`

Lit une seule section par identifiant avec une limite de caractères.

```json
{
  "sectionId": 123,
  "maxCharacters": 2000
}
```

## À éviter

Ne pas demander à Copilot de lire toutes les sections du catalogue.

Préférer une recherche ciblée, puis une lecture ciblée.

Les collections MCP `sources`, `documents`, `versions` et `sections` sont paginées par 20 éléments.
Leur taille sérialisée ne peut pas dépasser 24 000 caractères ; une section détaillée est limitée à
8 000 caractères. Suivre `nextUri` pour parcourir une collection sans lecture globale.

## Mesure V2.11

Le benchmark synthétique du 29 juillet 2026 couvre 100, 1 000 et 10 000 sections. À 10 000
sections, la resource paginée reste à 15 636 caractères au p95, soit environ 3 909 tokens, contre
4 733 639 caractères et environ 1 183 410 tokens pour la simulation historique non bornée. La
réduction mesurée est de 99,67 %.

Rapport brut :
[`benchmark-mcp-response-size-2026-07-29.json`](../planning/benchmark-results/benchmark-mcp-response-size-2026-07-29.json).
