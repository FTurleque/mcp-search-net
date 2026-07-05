# Validation Codex Desktop — MCP V2 documentaire — 2026-07-05

## Statut

- **Client testé** : Codex Desktop, avec appel MCP stdio local explicite.
- **Repo local** : `N:\workspace-dev\mcp-search-net`.
- **Branche** : `feat/v2-catalog-storage`.
- **Commit testé initialement** : `e5c6c68e4aa2f317bf84c85c607abe01302ed625`.
- **Head validé localement pour installation utilisateur** : `25c4aba04160ca3b46e8c70ce480a10c8df7e4d4`.
- **PR** : #8, conservée en draft.
- **GitHub Actions / CI GitHub** : non déclenchées.
- **Docker / services externes** : non utilisés pour cette validation `search_docs`.
- **Décision** : **GO avec réserve côté Codex Desktop**.

## Résumé exécutif

Le test documentaire V2 fonctionne via un client MCP stdio local explicite. Le serveur expose bien `search_docs`, l'appel `tools/call` répond correctement avec le provider `catalog`, et le catalogue de spike contient les dix documents attendus.

La validation locale du script d'installation utilisateur progresse également : `npm run check` passe entièrement sur le head courant après correction des exclusions Prettier temporaires. Le blocage restant ne vient plus de la qualité du projet, mais d'une instance utilisateur déjà active qui verrouille le dossier installé dans `%LOCALAPPDATA%`.

La réserve reste double :

1. `mcp-search-net` n'est pas exposé comme outil natif dans le thread Codex testé ;
2. la réinstallation utilisateur finale est bloquée par une instance active du serveur MCP déjà lancé.

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

Après fermeture partielle des blocages et mise à jour de la branche, la commande suivante a été relancée depuis PowerShell :

```powershell
cmd.exe /d /s /c N:/workspace-dev/mcp-search-net\\scripts\\intellij\\install-user.cmd
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

Détail Vitest :

```text
Test Files  34 passed (34)
Tests       178 passed (178)
Duration    2.30s
```

La phase de préparation du package utilisateur a également avancé :

```text
production dependencies install: OK
added 132 packages
found 0 vulnerabilities
```

## Réinstallation locale utilisateur

La commande d'installation utilisateur n'a pas encore abouti jusqu'au remplacement final du dossier installé.

Cause restante observée : une ancienne instance de `mcp-search-net` est encore active et peut verrouiller le dossier :

```text
PID: 23732
Nom: cmd.exe
CommandLine: cmd.exe /d /s /c C:\Users\fturl\AppData\Local\mcp-search-net\bin\mcp-search-net.cmd

PID: 11516
Nom: node.exe
CommandLine: "C:\Users\fturl\AppData\Local\mcp-search-net\runtime\node-v24.17.0-win-x64\node.exe" "C:\Users\fturl\AppData\Local\mcp-search-net\app\build\bootstrap\main.js"
```

Le dossier de staging reste présent :

```text
C:\Users\fturl\AppData\Local\mcp-search-net\.install-staging
```

Commande de nettoyage recommandée après fermeture des processus suspects :

```powershell
Remove-Item -LiteralPath 'C:\Users\fturl\AppData\Local\mcp-search-net\.install-staging' -Recurse -Force
```

Aucun processus n'a été tué pendant le test.

Action nécessaire avant une nouvelle tentative de réinstallation : fermer le serveur MCP actif dans Codex/IntelliJ, supprimer le staging restant, puis relancer l'installation utilisateur.

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
- Le build local passe sur le commit testé.
- Le catalogue de spike contient dix documents.
- L'index documentaire contient 133 sections.
- `catalog verify` retourne `OK` sans issue.
- Le serveur MCP démarre en stdio local.
- L'outil V2 `search_docs` est exposé.
- L'appel MCP `tools/call` vers `search_docs` répond correctement.
- Le provider retourné est `catalog`.
- Le catalogue de spike `.data/catalog-spike.db` est exploité.
- Aucun merge n'a été effectué.
- Aucun push local volontaire n'a été effectué depuis le poste de test.
- La PR n'a pas été passée en Ready for Review.
- Aucun workflow GitHub Actions n'a été déclenché.
- Aucune CI GitHub n'a été lancée.
- Aucun service Docker n'est nécessaire pour tester la recherche documentaire locale.
- Aucune opération mutable MCP n'est nécessaire.

## Réserve

Dans le thread Codex utilisé pour ce test, `mcp-search-net` n'était pas exposé comme outil natif Codex. La validation porte donc sur l'appel MCP stdio local explicite, pas sur l'ergonomie native du thread Codex.

Une réserve supplémentaire concerne la réinstallation utilisateur : le serveur installé dans `%LOCALAPPDATA%` n'a pas été remplacé parce qu'une instance active était déjà lancée.

La décision est donc **GO avec réserve** :

- **GO** pour le contrat MCP serveur, le build local, les tests locaux, le catalogue spike et l'outil `search_docs` ;
- **réserve** sur l'exposition native dans Codex Desktop ;
- **réserve** sur la réinstallation utilisateur tant que le serveur actif n'est pas fermé ;
- les resources MCP restent à valider si le client les expose directement.

## Suite recommandée

1. Fermer le serveur MCP actif dans Codex/IntelliJ.
2. Supprimer le staging restant avec `Remove-Item -LiteralPath 'C:\Users\fturl\AppData\Local\mcp-search-net\.install-staging' -Recurse -Force`.
3. Relancer `npm run install:user` depuis la branche `feat/v2-catalog-storage`.
4. Redémarrer Codex Desktop complètement.
5. Créer un nouveau thread Codex et retester l'exposition native de `mcp-search-net`.
6. Conserver `search_docs` comme surface principale si les resources MCP ne sont pas affichées directement par le client.
7. Exécuter la revalidation locale complète du head courant avant toute CI manuelle.
8. Ne pas déclencher GitHub Actions tant que le quota Actions minutes est épuisé.
