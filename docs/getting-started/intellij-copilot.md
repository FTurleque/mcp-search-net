# IntelliJ IDEA et GitHub Copilot

## Configurations de lancement partagées

Le dossier `.run` fournit des configurations Windows pour installer, lancer et
vérifier le serveur depuis IntelliJ :

- `MCP - Install user (Windows)` : valide, installe et démarre les conteneurs ;
- `MCP - Install and run (Windows)` : fait la même chose puis démarre le serveur STDIO dans la console IntelliJ.
- `MCP - Providers up (Windows)` : démarre SearXNG et Crawl4AI puis affiche leur état ;
- `MCP - Providers down (Windows)` : arrête les conteneurs du projet ;
- `MCP - Run local STDIO (Windows)` : compile le projet, démarre les providers et lance `build/bootstrap/main.js` avec la configuration locale ;
- `MCP - Verify deterministic (Windows)` : lance le build puis `npm run test:e2e:deterministic` ;
- `MCP - Verify live E2E (Windows)` : démarre les providers, compile et lance `npm run test:e2e:live`.

Les configurations passent par `scripts/intellij/run-powershell.cmd`, qui utilise
`pwsh.exe` si disponible puis `powershell.exe` en repli. La configuration
`MCP - Run local STDIO (Windows)` redirige les sorties de préparation vers
`stderr` afin que `stdout` reste réservé au protocole MCP JSON-RPC pendant
l'exécution du serveur.

Si IntelliJ affiche seulement un prompt PowerShell sans exécuter de commande,
recharger le projet depuis le disque ou supprimer/recréer la configuration Run
depuis le fichier `.run` partagé. Les configurations doivent pointer vers un
fichier `.cmd` dans `scripts/intellij`, pas vers un champ `Script text`.

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
        "\"C:\\Users\\<utilisateur>\\AppData\\Local\\mcp-search-net\\bin\\mcp-search-net.cmd\""
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
