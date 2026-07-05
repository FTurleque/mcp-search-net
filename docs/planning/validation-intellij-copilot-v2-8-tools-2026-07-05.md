# Validation IntelliJ/Copilot V2.8

IntelliJ détecte `mcp-search-net` en état `Running`.

Outils visibles :

- `search_web`
- `fetch_url`
- `search_docs`
- `list_docs`
- `read_doc_section`

Le client affiche 5 outils et 9 resources.

La détection des outils V2.8 est validée côté IntelliJ.

Reste à tester un échange complet avec le workflow :

```text
search_docs compact -> read_doc_section
```
