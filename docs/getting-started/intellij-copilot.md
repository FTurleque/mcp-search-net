# IntelliJ IDEA et GitHub Copilot

## Configurations de lancement partagées

Le dossier `.run` fournit deux configurations Windows :

- `MCP - Install user (Windows)` : valide, installe et démarre les conteneurs ;
- `MCP - Install and run (Windows)` : fait la même chose puis démarre le serveur STDIO dans la console IntelliJ.

La seconde configuration est utile pour observer le démarrage, mais la console Run d’IntelliJ n’est pas un client MCP. Pour un usage réel, GitHub Copilot doit lancer directement le script installé.

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
