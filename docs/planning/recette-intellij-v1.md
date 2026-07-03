# Recette manuelle IntelliJ / GitHub Copilot — V1

Cette recette clôt AC-02. Elle doit être exécutée dans IntelliJ IDEA avec GitHub
Copilot connecté ; les tests STDIO automatisés ne remplacent pas cette preuve UI.

## Préconditions

- Node.js 24 actif et `npm run build` réussi ;
- SearXNG et Crawl4AI sains ;
- configuration MCP installée selon `docs/getting-started/intellij-copilot.md` ;
- fenêtre IntelliJ redémarrée après modification de la configuration MCP.

## Dépannage : `better_sqlite3.node` verrouillé sous Windows

Si `MCP - Install user (Windows)` ou `MCP - Install and run (Windows)` échoue
pendant la suppression de l'ancienne installation avec un accès refusé sur
`better_sqlite3.node`, une ancienne instance MCP est probablement encore active.
IntelliJ/GitHub Copilot peut garder le processus Node lancé, ce qui maintient le
module natif SQLite chargé.

Diagnostic :

```powershell
Get-CimInstance Win32_Process |
  Where-Object {
    $_.CommandLine -like '*mcp-search-net*' -or
    $_.CommandLine -like '*better_sqlite3*' -or
    $_.CommandLine -like '*build/bootstrap/main.js*'
  } |
  Select-Object ProcessId, Name, CommandLine
```

Arrêt manuel :

```powershell
Stop-Process -Id <PID> -Force
```

Relance :

```powershell
scripts\intellij\install-user.cmd
scripts\intellij\install-and-run.cmd
```

Règle de recette : fermer IntelliJ avant de réinstaller si le serveur MCP était
lancé par Copilot. L'installateur doit afficher les processus suspects et
échouer proprement plutôt que produire une erreur brute `Access is denied`.

## Scénario

1. Ouvrir la fenêtre GitHub Copilot Chat et afficher les outils MCP disponibles.
2. Vérifier que le serveur `mcp-search-net` est connecté et n’expose que
   `search_web` et `fetch_url`.
3. Demander : « Recherche la documentation officielle Maven sur le cycle de vie ».
   Vérifier qu’une URL officielle, son statut et son score sont affichés.
4. Appeler `fetch_url` sur l’URL officielle obtenue avec la requête
   « phases default lifecycle ». Vérifier que la réponse contient des sections
   ciblées et conserve l’URL source.
5. Rejouer le même appel et vérifier `cacheStatus: HIT`.
6. Lancer une recherche `sourcePolicy: any` susceptible d’inclure une source non
   officielle et vérifier l’affichage de `NON_OFFICIAL_RESULTS_INCLUDED`.
7. Appeler `fetch_url` avec `file:///C:/Windows/win.ini` et vérifier le code stable
   `UNSUPPORTED_PROTOCOL`, sans contenu local.

## Preuve à archiver

| Élément                  | Valeur                                                                                     |
| ------------------------ | ------------------------------------------------------------------------------------------ |
| Date et opérateur        | 2026-06-29 — opérateur local                                                               |
| IntelliJ IDEA            | Terminal IntelliJ / PowerShell projet                                                      |
| Extension GitHub Copilot | Non vérifiée dans cette passe                                                              |
| Commit testé             | À compléter avec le commit candidat final                                                  |
| Deux outils seulement    | ✅ via `verify-deterministic.cmd` et `verify-live.cmd`                                     |
| Recherche officielle     | ✅ via suite E2E live                                                                      |
| Extraction ciblée        | ✅ via suite E2E live                                                                      |
| Cache HIT                | ✅ via suite E2E live                                                                      |
| Avertissement visible    | ✅ côté réponse/logs E2E ; non vérifié dans l'UI Copilot                                   |
| Erreur de protocole sûre | ✅ via `mcp-stdio.test.ts` et suite E2E                                                    |
| Lancement MCP local      | ✅ `run-local-mcp.cmd` : `server_started`, puis `server_stopped/SIGINT`                    |
| Installation utilisateur | ✅ `install-and-run.cmd` : installation, `npm run check`, providers healthy, serveur lancé |
| Providers Docker         | ✅ `providers-up.cmd` healthy ; `providers-down.cmd` supprime conteneurs et réseaux        |
| Affichage outils Copilot | ✅ capture IntelliJ/Copilot du 2026-07-03 : `mcp-search-net` `Running`, 2 outils visibles  |

## Statut AC-02

AC-02 : PARTIEL — lancement manuel IntelliJ/Windows validé, affichage
IntelliJ/Copilot des outils validé, appels directs depuis GitHub Copilot Chat
non encore exécutés.

Motif :
La passe du 29 juin 2026 valide les scripts `.run`/`.cmd`, le démarrage des
providers Docker, le serveur MCP STDIO local, la suite E2E live, la suite
déterministe et l'installation utilisateur avec lancement du serveur. La capture
du 3 juillet 2026 valide que l'interface IntelliJ/Copilot affiche
`mcp-search-net` en état `Running` avec exactement `search_web` et `fetch_url`.
Elle ne contient pas encore de preuve que GitHub Copilot Chat appelle
directement les deux outils depuis une conversation.

Date prévue :
À compléter par l’opérateur pour la vérification des appels depuis Copilot Chat.

Impact :
V1 OPÉRATIONNELLE AVEC RÉSERVES
V2 BUILD NO-GO

## Validation manuelle du lancement — 2026-06-29

Commandes exécutées manuellement depuis le terminal IntelliJ / PowerShell :

```powershell
N:/workspace-dev/mcp-search-net/scripts/intellij/verify-live.cmd
N:/workspace-dev/mcp-search-net/scripts/intellij/verify-deterministic.cmd
N:/workspace-dev/mcp-search-net/scripts/intellij/run-local-mcp.cmd
N:/workspace-dev/mcp-search-net/scripts/intellij/providers-up.cmd
N:/workspace-dev/mcp-search-net/scripts/intellij/providers-down.cmd
N:/workspace-dev/mcp-search-net/scripts/intellij/install-and-run.cmd
```

Preuves observées :

- `verify-live.cmd` : SearXNG et Crawl4AI `Healthy`, puis `REQUIRED_SUITE_VALID e2e-live: 7 passed, 0 skipped`.
- `verify-deterministic.cmd` : `tests/e2e/mcp-stdio.test.ts`, `2 passed`.
- `run-local-mcp.cmd` : build TypeScript, providers `Healthy`, log `server_started`, arrêt `server_stopped` avec `reason: SIGINT` et `exitCode: 0`.
- `providers-up.cmd` : deux conteneurs `healthy`, ports `127.0.0.1:8888` et `127.0.0.1:11235`.
- `providers-down.cmd` : conteneurs et réseaux Compose supprimés.
- `install-and-run.cmd` : téléchargement Node.js 24.17.0, `npm run check` vert, 139 tests globaux passés, dépendances de production installées, providers utilisateur `Healthy`, serveur MCP lancé puis arrêté proprement.
- Contrôle complémentaire du nom Compose canonique : `mcp-search-net-services.cmd up -d --wait searxng crawl4ai` démarre `mcp-search-net-crawl4ai-1` et `mcp-search-net-searxng-1` en `healthy`, sans suffixe `user`; `mcp-search-net-services.cmd down` supprime ensuite les conteneurs et réseaux, puis `docker ps --filter name=mcp-search-net` ne retourne aucune ligne.

## Validation corrective Windows — 2026-07-03

Objectif : fiabiliser `MCP - Install user (Windows)` et
`MCP - Install and run (Windows)` quand une ancienne instance MCP conserve
`better_sqlite3.node` verrouillé.

Résultats observés :

- `npm ci`, `npm run format:check`, `npm run lint`, `npm run typecheck`,
  `npm run build`, `npm test` et `npm run test:e2e:deterministic` : verts.
- `providers-down.cmd` : exit 0.
- `providers-up.cmd` : SearXNG et Crawl4AI `healthy`.
- `providers-down.cmd` : conteneurs et réseaux supprimés.
- Premier `install-user.cmd` avec une ancienne instance MCP active : exit non
  nul contrôlé, message explicite, PID/nom/ligne de commande affichés pour le
  `cmd.exe` installé et le `node.exe build/bootstrap/main.js`, staging conservé
  avec consigne de nettoyage.
- Après arrêt manuel des PID détectés : `install-user.cmd` réussit, nettoie le
  staging, renomme l'ancienne installation en `app.previous-*`, active la
  nouvelle installation et démarre les providers en `healthy`.
- Deuxième `install-user.cmd` immédiat : réussi.
- `install-and-run.cmd` testé via un client MCP STDIO : installation réussie,
  serveur lancé, `tools/list` retourne exactement
  `["fetch_url", "search_web"]`, diagnostics présents sur `stderr`.

Preuve UI ajoutée le 3 juillet 2026 : capture IntelliJ/Copilot
`Configure Tools`, serveur `mcp-search-net` en état `Running`, deux outils
visibles et cochés : `search_web` et `fetch_url`.

Limite inchangée : cette passe valide les scripts Windows, le transport MCP
contrôlé et l'affichage des outils dans IntelliJ/Copilot ; les appels réels
depuis une conversation GitHub Copilot Chat restent à vérifier manuellement.
