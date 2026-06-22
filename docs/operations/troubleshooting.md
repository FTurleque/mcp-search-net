# Dépannage

## Les outils n’apparaissent pas dans Copilot

- vérifier que le chemin dans `mcp.json` vient du fichier généré `%LOCALAPPDATA%\mcp-search-net\mcp.json.example` ;
- redémarrer le serveur MCP dans l’interface Copilot ;
- vérifier que le lanceur et `app\build\bootstrap\main.js` existent ;
- consulter `stderr` dans les journaux Copilot/IntelliJ.

## SearXNG ou Crawl4AI est indisponible

```powershell
& "$env:LOCALAPPDATA\mcp-search-net\bin\mcp-search-net-services.cmd" ps
& "$env:LOCALAPPDATA\mcp-search-net\bin\mcp-search-net-services.cmd" logs
```

Vérifier que Docker Desktop tourne, que les ports 8888 et 11235 sont libres et que Docker dispose d’assez de mémoire. Crawl4AI peut mettre plus d’une minute à devenir sain au premier démarrage.

## Échec de l’installation Node ou npm

Vérifier l’accès HTTPS à `nodejs.org` et au registre npm, ainsi que l’espace libre sous `%LOCALAPPDATA%`. Supprimer uniquement le sous-dossier `runtime\node-v24.17.0-win-x64` incomplet, puis relancer l’installateur.

## Configuration invalide

Comparer le fichier concerné avec sa copie `.default`. Les chemins relatifs sont résolus depuis le dossier du fichier `application.yml`. Le cache utilisateur doit donc rester `../data/cache.sqlite`.

## Une URL publique est refusée

Le domaine peut résoudre vers une adresse privée/réservée, contenir un port interdit ou utiliser une redirection dangereuse. Ce refus est volontaire. Ne désactiver la politique URL que dans un test isolé.

## Le serveur semble silencieux

C’est normal lorsqu’aucun client MCP ne lui envoie de message. `stdout` est réservé au protocole. Utiliser Copilot ou un client MCP de test, et lire les logs sur `stderr`.
