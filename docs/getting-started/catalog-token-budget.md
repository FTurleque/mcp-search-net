# Catalogue V2.8 — usage sobre avec Copilot

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

Liste les documents sans contenu de section.

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
