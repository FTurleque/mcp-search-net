# Recette manuelle IntelliJ / GitHub Copilot — V1

Cette recette clôt AC-02. Elle doit être exécutée dans IntelliJ IDEA avec GitHub
Copilot connecté ; les tests STDIO automatisés ne remplacent pas cette preuve UI.

## Préconditions

- Node.js 24 actif et `npm run build` réussi ;
- SearXNG et Crawl4AI sains ;
- configuration MCP installée selon `docs/getting-started/intellij-copilot.md` ;
- fenêtre IntelliJ redémarrée après modification de la configuration MCP.

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

## Statut AC-02

AC-02 : PARTIEL — lancement manuel IntelliJ/Windows validé, interaction
GitHub Copilot Chat non encore exécutée.

Motif :
La passe du 29 juin 2026 valide les scripts `.run`/`.cmd`, le démarrage des
providers Docker, le serveur MCP STDIO local, la suite E2E live, la suite
déterministe et l'installation utilisateur avec lancement du serveur. Elle ne
contient pas encore de preuve que GitHub Copilot Chat affiche et appelle
directement les deux outils.

Date prévue :
À compléter par l’opérateur pour la vérification UI Copilot Chat.

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
