# PR #8 — V2 documentaire

## Statut

- PR : #8.
- Branche : `feat/v2-catalog-storage`.
- Statut : draft.
- Merge : non effectué.
- Ready for Review : non effectué.
- GitHub Actions : non déclenchées pendant les validations locales récentes.

## Avancement

- V2.6 validée localement.
- V2.7 validée localement.
- V2.8 validée localement hors CI.

## Surface MCP visible dans IntelliJ

IntelliJ voit `mcp-search-net` en `Running`.

Outils visibles :

- `search_web`
- `fetch_url`
- `search_docs`
- `list_docs`
- `read_doc_section`

IntelliJ affiche 5 tools et 9 resources.

## V2.8

La tranche V2.8 ajoute :

- `search_docs` compact ;
- `maxSnippetChars` ;
- `list_docs` ;
- `read_doc_section` ;
- `mcp-search-net://sections` en mode compact.

La resource globale `mcp-search-net://sections` ne retourne plus le champ `content`. Le contenu complet reste accessible via `mcp-search-net://sections/{sectionId}` ou via `read_doc_section`.

## Reste à faire

- Test conversationnel complet Copilot.
- Benchmark taille des réponses MCP.
- Nettoyage dette Prettier/ESLint.
- Amélioration installation utilisateur quand une ancienne instance est active.
