# Validation Codex Desktop — MCP V2 documentaire — 2026-07-05

## Statut

- **Client testé** : Codex Desktop, avec appel MCP stdio local explicite.
- **Repo local** : `N:\workspace-dev\mcp-search-net`.
- **Branche** : `feat/v2-catalog-storage`.
- **Commit testé initialement** : `e5c6c68e4aa2f317bf84c85c607abe01302ed625`.
- **Head validé localement pour installation utilisateur** : `25c4aba04160ca3b46e8c70ce480a10c8df7e4d4` puis `a508a8679b13f987cb98d797cf0be71cf33695b6`.
- **PR** : #8, conservée en draft.
- **GitHub Actions / CI GitHub** : non déclenchées.
- **Décision** : **GO avec réserve côté Codex Desktop**.

## Résumé exécutif

Le test documentaire V2 fonctionne via un client MCP stdio local explicite. Le serveur expose bien `search_docs`, l'appel `tools/call` répond correctement avec le provider `catalog`, et le catalogue de spike contient les dix documents attendus.

La validation locale et l'installation utilisateur sont maintenant passées : `npm run check` passe entièrement, les dépendances de production sont installées, l'ancienne installation utilisateur est renommée, le lanceur MCP est généré, et les services locaux SearXNG/Crawl4AI démarrent avec un état healthy.

La réserve restante concerne l'ergonomie Codex Desktop : `mcp-search-net` n'était pas exposé comme outil natif dans le thread Codex testé. Le test MCP a donc été réalisé via client MCP stdio local explicite.

## Git et build local

État local initial observé :

```text
repo: N:\workspace-dev\mcp-search-net
branch: feat/v2-catalog-storage
commit: e5c6c68e4aa2f317bf84c85c607abe01302ed625
remote alignment: 0 ahead / 0 behind with origin/feat/v2-catalog-storage
final worktree: clean
```

Commandes de préparation initiales :

```text
npm install: OK
npm run build: OK
```

Le fichier `.env` contient bien les deux variables suivantes :

- `MCP_CRAWL4AI_TOKEN` ;
- `CRAWL4AI_API_TOKEN`.

Les deux variables existent, ont la même valeur, et leur valeur n'a pas été affichée dans le compte-rendu.

## Validation locale installation utilisateur

Après nettoyage du staging et fermeture des processus bloquants, la commande suivante a été relancée depuis PowerShell :

```powershell
cmd.exe /d /s /c N:/workspace-dev/mcp-search-net/scripts/intellij/install-user.cmd
```

Résultat de la phase de validation projet :

```text
npm install: OK
check:runtime: OK, Node.js runtime validated: 24.17.0
check:copilot: OK, Copilot configuration validated: 5 agents, 7 prompts, 5 path instructions, 1 skill(s)
format:check: OK, All matched files use Prettier code style
lint: OK
typecheck: OK
build: OK
test: OK, 34 test files passed, 178 tests passed
```

Détail Vitest final :

```text
Test Files  34 passed (34)
Tests       178 passed (178)
Duration    1.95s
```

La phase de préparation du package utilisateur est validée :

```text
production dependencies install: OK
added 132 packages
found 0 vulnerabilities
```

## Installation utilisateur

Installation terminée avec succès.

Résultat observé :

```text
Renommage de l'ancienne installation : C:\Users\fturl\AppData\Local\mcp-search-net\app.previous-20260705-144721
Installation terminée. Lanceur MCP : C:\Users\fturl\AppData\Local\mcp-search-net\bin\mcp-search-net.cmd
Exemple Copilot : C:\Users\fturl\AppData\Local\mcp-search-net\mcp.json.example
```

Services locaux démarrés par le script :

```text
Arrêt éventuel de l'ancien projet Compose mcp-search-net-user...
Démarrage de SearXNG et Crawl4AI...
[+] up 4/4
Network mcp-search-net_backend Created
Network mcp-search-net_egress Created
Container mcp-search-net-crawl4ai-1 Healthy
Container mcp-search-net-searxng-1 Healthy
```

## Catalogue spike

Le catalogue de spike existe :

```text
.data/catalog-spike.db
```

Résultats des commandes catalogue :

```text
rebuild-index: indexedSections: 133
verify: status: OK, issues: 0
status: documentCount: 10
```

Ce résultat valide que le corpus documentaire minimal de spike est présent et indexé.

## Configuration Codex

Le fichier suivant contient bien le serveur MCP :

```text
%USERPROFILE%\.codex\config.toml
```

Bloc attendu présent :

```toml
[mcp_servers.mcp-search-net]
```

Contrôles réalisés :

- `command = "cmd.exe"` ;
- `args` pointe vers `N:\workspace-dev\mcp-search-net\scripts\intellij\run-local-mcp.cmd` ;
- `cwd = "N:\workspace-dev\mcp-search-net"` ;
- `MCP_CONFIG_PATH` pointe vers le repo local ;
- `MCP_CATALOG_PATH` pointe vers `N:\workspace-dev\mcp-search-net\.data\catalog-spike.db` ;
- le token est masqué.

## Test MCP

Méthode utilisée : client MCP stdio local explicite.

### `tools/list`

Statut : OK.

Outils exposés :

- `search_web` ;
- `fetch_url` ;
- `search_docs`.

### `tools/call` — `search_docs`

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

1. `ADR-016 MCP V2 : Resources implémentées ou en cours de stabilisation`
2. `ADR-016 MCP V2 : Critères d'acceptation avant gel définitif`
3. `ADR-016 MCP V2 : ADR-016 — Exposer la V2 avec un outil de recherche et des resources MCP`
4. `ADR-016 MCP V2 : Positives`
5. `ADR-016 MCP V2 : Contexte`

## Ce que ce test valide

- `npm run check` passe localement sur le head courant de PR.
- Le runtime Node.js embarqué est validé en 24.17.0.
- La configuration Copilot est valide.
- Prettier, ESLint, TypeScript, build et Vitest passent localement.
- Les 34 fichiers de test passent.
- Les 178 tests passent.
- Les dépendances de production s'installent correctement.
- L'installation utilisateur aboutit.
- L'ancienne installation utilisateur est conservée via `app.previous-*`.
- Le lanceur `%LOCALAPPDATA%\mcp-search-net\bin\mcp-search-net.cmd` est généré.
- Le fichier d'exemple `%LOCALAPPDATA%\mcp-search-net\mcp.json.example` est généré.
- SearXNG et Crawl4AI démarrent et passent healthy.
- Le catalogue de spike contient dix documents.
- L'index documentaire contient 133 sections.
- `catalog verify` retourne `OK` sans issue.
- Le serveur MCP démarre en stdio local.
- L'outil V2 `search_docs` est exposé.
- L'appel MCP `tools/call` vers `search_docs` répond correctement.
- Le provider retourné est `catalog`.
- Le catalogue de spike `.data/catalog-spike.db` est exploité.
- Aucun merge n'a été effectué.
- La PR n'a pas été passée en Ready for Review.
- Aucun workflow GitHub Actions n'a été déclenché.
- Aucune CI GitHub n'a été lancée.
- Aucune opération mutable MCP n'est nécessaire.

## Réserve

Dans le thread Codex utilisé pour ce test, `mcp-search-net` n'était pas exposé comme outil natif Codex. La validation porte donc sur l'appel MCP stdio local explicite, pas sur l'ergonomie native du thread Codex.

La décision est donc **GO avec réserve** :

- **GO** pour le contrat MCP serveur, le build local, les tests locaux, l'installation utilisateur, le catalogue spike et l'outil `search_docs` ;
- **réserve** sur l'exposition native dans Codex Desktop ;
- les resources MCP restent à valider si le client les expose directement.

## Suite recommandée

1. Redémarrer Codex Desktop complètement.
2. Créer un nouveau thread Codex et retester l'exposition native de `mcp-search-net`.
3. Conserver `search_docs` comme surface principale si les resources MCP ne sont pas affichées directement par le client.
4. Exécuter une revalidation via CI manuelle après reset du quota Actions.
5. Ne pas déclencher GitHub Actions tant que le quota Actions minutes est épuisé.
