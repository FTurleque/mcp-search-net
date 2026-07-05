# Validation locale V2.8 — outils compacts MCP — 2026-07-05

## Statut

- Branche : `feat/v2-catalog-storage`.
- PR : #8, conservée en draft.
- Merge : non effectué.
- Ready for Review : non effectué.
- GitHub Actions : non déclenchées.
- Décision : V2.8 applicative validée localement sur les outils compacts MCP.

## Périmètre validé

- `search_docs` enrichi avec options compactes.
- `list_docs` exposé en outil MCP read-only compact.
- `read_doc_section` exposé en outil MCP read-only ciblé.
- Documentation dédiée au workflow sobre Copilot.
- Test E2E MCP STDIO mis à jour.

## Résultats validés

- `npm run format:check` : OK.
- `npm run lint` : OK.
- `npm run typecheck` : OK.
- `npm run build` : OK.
- `npm run test` : OK.
- Tests : 36 fichiers passés, 182 tests passés.

## Conclusion

La tranche V2.8 applicative est validée localement. Le workflow recommandé devient :

```text
search_docs compact -> read_doc_section ciblé
```

Cette approche réduit le risque que Copilot lise trop de contenu documentaire en une seule fois.
