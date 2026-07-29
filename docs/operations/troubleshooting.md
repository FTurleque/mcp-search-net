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

Vérifier l’accès HTTPS à `nodejs.org` et au registre npm, ainsi que l’espace libre sous `%LOCALAPPDATA%`. `RUNTIME_ARCHIVE_CHECKSUM_MISMATCH` signifie que l'archive a été refusée avant extraction ; ne contournez pas le contrôle. Une signature Authenticode invalide ou un signataire autre qu'OpenJS doit aussi bloquer l'installation. Le manifeste `runtime\node-runtime-proof.json` permet de contrôler version, SHA du binaire, signature et date de vérification.

Un `EPERM` sur `better_sqlite3.node` dans le dépôt signifie généralement qu'un
processus Node a chargé ce module natif. Identifier sa ligne de commande avant de
l'arrêter ; la recette d'installation travaille depuis une copie temporaire pour
ne pas perturber un serveur MCP actif.

## Secrets Compose absents ou refusés

Compose exige `.env` avec `SEARXNG_SECRET` et `CRAWL4AI_API_TOKEN`. Dans une
installation utilisateur, relancer `install-user.ps1` génère le fichier s'il est
absent. Dans le dépôt, copier `.env.example`, remplacer toutes les valeurs
`replace-with-*` et conserver `MCP_PROFILE=development` uniquement pour le
développement local.

## Catalogue dégradé

Exécuter `npm run catalog:health -- --path <catalog.db>`. Ne lancez ni `VACUUM`
ni une restauration sur une base ouverte. Créez régulièrement des snapshots avec
`catalog backup`, conservez la base dégradée pour diagnostic, puis restaurez vers
un nouveau chemin et revalidez avec `catalog health`.

Un lock de maintenance invalide, distant ou dont le PID local est vivant n'est
jamais supprimé automatiquement. Vérifier son JSON, le hostname et le PID ; ne
retirer manuellement le fichier qu'après avoir prouvé qu'aucun propriétaire ne
peut encore écrire.

## Configuration invalide

Comparer le fichier concerné avec sa copie `.default`. Les chemins relatifs sont résolus depuis le dossier du fichier `application.yml`. Le cache utilisateur doit donc rester `../data/cache.sqlite`.

## Une URL publique est refusée

Le domaine peut résoudre vers une adresse privée/réservée, contenir un port interdit ou utiliser une redirection dangereuse. Ce refus est volontaire. Ne désactiver la politique URL que dans un test isolé.

## Le serveur semble silencieux

C’est normal lorsqu’aucun client MCP ne lui envoie de message. `stdout` est réservé au protocole. Utiliser Copilot ou un client MCP de test, et lire les logs sur `stderr`.
