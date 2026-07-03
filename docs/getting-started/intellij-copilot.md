# IntelliJ IDEA et GitHub Copilot

## Configurations de lancement partagées

Le dossier `.run` fournit des configurations Windows pour installer, lancer et
vérifier le serveur depuis IntelliJ. Toutes les configurations utilisent des
fichiers `.cmd` dans `scripts/intellij` afin d'éviter les consoles PowerShell
ouvertes sans commande.

| Configuration                | Script                                      | Usage                                                                  | Nom Compose      |
| ---------------------------- | ------------------------------------------- | ---------------------------------------------------------------------- | ---------------- |
| `MCP - Verify deterministic` | `scripts/intellij/verify-deterministic.cmd` | Build + test MCP STDIO sans Docker ni réseau                           | aucun            |
| `MCP - Verify live E2E`      | `scripts/intellij/verify-live.cmd`          | Démarre les providers, build, puis lance l'E2E live                    | `mcp-search-net` |
| `MCP - Providers up`         | `scripts/intellij/providers-up.cmd`         | Démarre SearXNG et Crawl4AI puis affiche `docker compose ps`           | `mcp-search-net` |
| `MCP - Providers down`       | `scripts/intellij/providers-down.cmd`       | Arrête les conteneurs et réseaux du projet local                       | `mcp-search-net` |
| `MCP - Run local STDIO`      | `scripts/intellij/run-local-mcp.cmd`        | Compile, démarre les providers et lance `build/bootstrap/main.js`      | `mcp-search-net` |
| `MCP - Install user`         | `scripts/intellij/install-user.cmd`         | Installe dans `%LOCALAPPDATA%\mcp-search-net` et démarre les providers | `mcp-search-net` |
| `MCP - Install and run`      | `scripts/intellij/install-and-run.cmd`      | Même installation, puis lance le serveur MCP STDIO installé            | `mcp-search-net` |

Les configurations passent par `scripts/intellij/run-powershell.cmd`, qui affiche
le PowerShell retenu, utilise `pwsh.exe` si disponible puis `powershell.exe` en
repli, et renvoie le code de sortie du script PowerShell appelé. Les
configurations `MCP - Install user (Windows)` et
`MCP - Install and run (Windows)` déclarent explicitement `cmd.exe /d /s /c`
comme interpréteur Windows afin de lancer les `.cmd` de façon stable depuis
IntelliJ. La configuration
`MCP - Run local STDIO (Windows)` redirige les sorties de préparation vers
`stderr` afin que `stdout` reste réservé au protocole MCP JSON-RPC pendant
l'exécution du serveur.

Si IntelliJ affiche seulement un prompt PowerShell sans exécuter de commande,
recharger le projet depuis le disque ou supprimer/recréer la configuration Run
depuis le fichier `.run` partagé. Les configurations doivent pointer vers un
fichier `.cmd` dans `scripts/intellij`, pas vers un champ `Script text`.

Le nom Docker Compose attendu est `mcp-search-net`. Les anciens conteneurs ou
réseaux `mcp-search-net-user-*` proviennent d'une version antérieure des scripts.
L'installation utilisateur actuelle arrête cet ancien projet avant de démarrer
les services avec le nom canonique. Pour forcer un autre nom temporairement,
définir `MCP_SEARCH_COMPOSE_PROJECT`, mais ne pas le faire pour la recette V1.
Les configurations locales du dépôt et l'installation utilisateur partagent ce
nom canonique : utiliser une seule famille de lanceurs à la fois.

Validation manuelle du 29 juin 2026 : `verify-live.cmd`,
`verify-deterministic.cmd`, `run-local-mcp.cmd`, `providers-up.cmd`,
`providers-down.cmd` et `install-and-run.cmd` ont été exécutés depuis le terminal
IntelliJ/PowerShell. Les suites live et déterministe sont vertes, les providers
passent `healthy`, et le serveur MCP émet `server_started` puis
`server_stopped` lors de l'arrêt manuel.

La configuration de lancement serveur est utile pour observer le démarrage, mais
la console Run d’IntelliJ n’est pas un client MCP. Pour un usage réel, GitHub
Copilot doit lancer directement le script installé.

Les configurations utilisent le type JetBrains « Shell Script ». Si IntelliJ le demande, activer le plugin officiel Shell Script.

## Dépannage : `better_sqlite3.node` verrouillé sous Windows

Pendant une réinstallation utilisateur, Windows peut refuser la suppression de
`%LOCALAPPDATA%\mcp-search-net\app\node_modules\better-sqlite3\build\Release\better_sqlite3.node`.
La cause probable est une ancienne instance MCP encore lancée : IntelliJ ou
GitHub Copilot garde un processus Node actif, et ce processus conserve le module
natif SQLite chargé.

Depuis PowerShell, diagnostiquer les processus suspects :

```powershell
Get-CimInstance Win32_Process |
  Where-Object {
    $_.CommandLine -like '*mcp-search-net*' -or
    $_.CommandLine -like '*better_sqlite3*' -or
    $_.CommandLine -like '*build/bootstrap/main.js*'
  } |
  Select-Object ProcessId, Name, CommandLine
```

Arrêter manuellement le processus identifié :

```powershell
Stop-Process -Id <PID> -Force
```

Puis relancer :

```powershell
scripts\intellij\install-user.cmd
scripts\intellij\install-and-run.cmd
```

Règle pratique : fermer IntelliJ avant de réinstaller si le serveur MCP était
lancé par GitHub Copilot. Par défaut, l'installateur ne tue pas automatiquement
IntelliJ ni un processus inconnu ; il affiche les processus suspects et échoue
avec un message explicite. L'option PowerShell `-ForceStopExistingProcess` existe
pour une intervention volontaire, mais elle n'est pas utilisée par les
configurations IntelliJ partagées.

## Déclarer le serveur dans Copilot

Après installation, ouvrir le fichier `%LOCALAPPDATA%\mcp-search-net\mcp.json.example`. Il contient le chemin absolu adapté à l’utilisateur courant. Copier l’entrée `mcp-search-net` dans la configuration MCP affichée par Copilot via **Configure MCP Servers**.

Forme attendue :

```json
{
  "servers": {
    "mcp-search-net": {
      "command": "cmd.exe",
      "args": [
        "/d",
        "/s",
        "/c",
        "C:\\Users\\<utilisateur>\\AppData\\Local\\mcp-search-net\\bin\\mcp-search-net.cmd"
      ]
    }
  }
}
```

Utiliser de préférence le fichier généré : il évite les erreurs d’échappement JSON et de nom d’utilisateur. Redémarrer le serveur MCP depuis l’interface Copilot après chaque réinstallation.

## Vérification

1. Exécuter `mcp-search-net-services.cmd ps` et vérifier que les deux services sont sains.
2. Ouvrir Copilot Chat et afficher les outils MCP.
3. Vérifier la présence de `search_web` et `fetch_url` uniquement.
4. Demander une recherche simple, puis la récupération d’une URL publique HTTPS.

Les logs du serveur apparaissent sur `stderr`. Aucune sortie libre ne doit apparaître sur `stdout`, réservé au protocole MCP.
