# Mise à jour roadmap V2.8

V2.8 est implémentée et validée localement.

Livré :

- `search_docs` compact ;
- `maxSnippetChars` ;
- `list_docs` ;
- `read_doc_section` ;
- `mcp-search-net://sections` en mode compact ;
- documentation du workflow sobre ;
- test E2E compact resources.

Validation locale :

- format OK ;
- lint OK ;
- typecheck OK ;
- build OK ;
- tests OK ;
- 36 fichiers de tests passés ;
- 182 tests passés.

Reste hors CI :

- spike final IntelliJ/Copilot ;
- benchmark taille des réponses MCP ;
- nettoyage progressif dette Prettier/ESLint.

Workflow cible :

```text
search_docs compact -> read_doc_section ciblé
```
