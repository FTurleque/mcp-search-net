# Validation Codex Desktop — MCP V2 documentaire — 2026-07-05

## Statut

- **Client testé** : Codex Desktop, avec appel MCP stdio local explicite.
- **Branche** : `feat/v2-catalog-storage`.
- **PR** : #8, conservée en draft.
- **GitHub Actions** : non déclenché.
- **Docker / services externes** : non utilisés pour cette validation `search_docs`.
- **Décision** : **GO avec réserve côté Codex Desktop**.

## Contexte

Le serveur installé ou lancé par le client doit être mis à jour avec les modifications de la branche `feat/v2-catalog-storage` avant test. Sinon, Codex ou le client MCP local peut appeler une ancienne version du serveur qui n'expose pas encore `search_docs` ou les resources V2.

Pour cette validation, `mcp-search-net` n'était pas exposé comme outil natif du thread Codex. Le test a donc été exécuté via un client MCP stdio local, en pointant explicitement `MCP_CATALOG_PATH` vers le catalogue de spike :

```text
.data/catalog-spike.db
```

Cette méthode reste un vrai appel MCP `tools/call` vers `search_docs`.

## Outils exposés

Le serveur expose bien les outils suivants :

- `fetch_url` ;
- `search_docs` ;
- `search_web`.

## Appel validé

Requête fonctionnelle :

```text
search_docs("resources MCP V2")
```

Résultat observé :

```text
status: success
resultCount: 5
warnings: []
provider: catalog
```

Top résultats retournés :

1. `ADR-016 MCP V2 — Resources implémentées ou en cours de stabilisation`
2. `ADR-016 MCP V2 — Critères d'acceptation avant gel définitif`
3. `ADR-016 MCP V2 — ADR-016 — Exposer la V2 avec un outil de recherche et des resources MCP`
4. `ADR-016 MCP V2 — Positives`
5. `ADR-016 MCP V2 — Contexte`

## Ce que ce test valide

- Le serveur MCP démarre en stdio local.
- L'outil V2 `search_docs` est exposé.
- L'appel MCP `tools/call` vers `search_docs` répond correctement.
- Le provider retourné est `catalog`.
- Le catalogue de spike `.data/catalog-spike.db` est exploité.
- Aucun workflow GitHub Actions n'est déclenché.
- Aucun service Docker n'est nécessaire pour tester la recherche documentaire locale.
- Aucune opération mutable MCP n'est nécessaire.

## Réserve

Dans le thread Codex utilisé pour ce test, `mcp-search-net` n'était pas exposé comme outil natif Codex. La validation porte donc sur l'appel MCP stdio local explicite, pas sur l'ergonomie native du thread Codex.

La décision est donc **GO avec réserve** :

- **GO** pour le contrat MCP serveur et l'outil `search_docs` ;
- **réserve** sur l'exposition native dans Codex Desktop ;
- les resources MCP restent à valider si le client les expose directement.

## Suite recommandée

1. Redéployer ou réinstaller localement le serveur depuis la branche `feat/v2-catalog-storage` avant chaque test client.
2. Retester l'exposition native Codex après redémarrage complet de Codex Desktop et recréation du thread.
3. Conserver `search_docs` comme surface principale si les resources MCP ne sont pas affichées directement par le client.
4. Exécuter la revalidation locale complète du head courant avant toute CI manuelle.
5. Ne pas déclencher GitHub Actions tant que le quota Actions minutes est épuisé.
