# Installation Windows

## Prérequis

- Windows 10 ou 11 64 bits ;
- PowerShell 5.1 ou supérieur ;
- Docker Desktop avec Docker Compose ;
- accès à `nodejs.org` et au registre npm lors de l’installation ;
- environ 4 Go de mémoire disponibles pour Docker.

L’installation ne demande pas de droits administrateur. Elle cible toujours le profil de l’utilisateur courant :

```text
%LOCALAPPDATA%\mcp-search-net
```

Cela correspond généralement à `C:\Users\<utilisateur>\AppData\Local\mcp-search-net`. Tous les utilisateurs obtiennent donc la même arborescence relative, mais leurs configurations, caches et processus restent isolés.

## Installation

Depuis la racine du dépôt :

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\install-user.ps1 -StartServices
```

Le script télécharge Node.js 24.17.0 LTS depuis `nodejs.org`, vérifie le
SHA-256 officiel avant extraction, exige une signature Authenticode OpenJS
valide, puis écrit `runtime\node-runtime-proof.json`. Il valide et compile le
projet, installe uniquement les dépendances de production, puis démarre SearXNG
et Crawl4AI. Un runtime téléchargé invérifiable est supprimé et jamais activé.
Le script ne modifie ni le `PATH` système, ni le registre Windows.

À la première installation, deux secrets aléatoires sont générés dans `.env`
pour SearXNG et Crawl4AI. Ce fichier n'est pas remplacé lors d'une mise à jour et
ne doit pas être commité.

Une installation existante conserve `config\application.yml`, `config\official-sources.yml`, `config\searxng\settings.yml` et `data`. Les nouvelles valeurs de référence sont placées à côté avec le suffixe `.default`.

## Arborescence installée

```text
%LOCALAPPDATA%\mcp-search-net\
├── app\                 application compilée et dépendances de production
├── bin\                 launchers MCP, Docker et opérations catalogue
├── config\              configuration persistante
├── data\                cache Web et catalogue SQLite persistants
├── docs\                copie de cette documentation
├── runtime\              Node.js portable
│   └── node-runtime-proof.json
├── .env                  secrets fournisseurs générés localement
├── compose.yaml         mode complet, services internes
├── compose.hybrid.yaml  compatibilité des installations antérieures
├── migrations\          migrations du cache pour le build conteneur
├── catalog-migrations\  migrations du catalogue pour le build conteneur
├── mcp.json.example
├── mcp.container.json.example
├── BUILD-MANIFEST.json  version, runtime et révision source installée
└── VERSION
```

Le lanceur stable à déclarer dans Copilot est `%LOCALAPPDATA%\mcp-search-net\bin\mcp-search-net.cmd`.

## Services

```powershell
& "$env:LOCALAPPDATA\mcp-search-net\bin\mcp-search-net-services.cmd" up -d
& "$env:LOCALAPPDATA\mcp-search-net\bin\mcp-search-net-services.cmd" ps
& "$env:LOCALAPPDATA\mcp-search-net\bin\mcp-search-net-services.cmd" down
```

SearXNG écoute uniquement sur `127.0.0.1:8888` et Crawl4AI sur `127.0.0.1:11235`.

Le nom Docker Compose canonique de l'installation utilisateur est
`mcp-search-net`. Les conteneurs attendus sont donc
`mcp-search-net-searxng-1` et `mcp-search-net-crawl4ai-1`. Les anciens noms
`mcp-search-net-user-*` proviennent d'une version antérieure des scripts ;
l'installateur actuel les arrête sans supprimer les volumes avant de démarrer
le nom canonique.

## Mode Compose complet

Le lanceur conteneurisé démarre les dépendances sans publier leurs ports, puis attache le serveur MCP en STDIO sans TTY :

```text
%LOCALAPPDATA%\mcp-search-net\bin\mcp-search-net-container.cmd
```

Utiliser `mcp.container.json.example` dans Copilot. Le service MCP appartient au profil explicite
`stdio`, donc un simple `docker compose up -d` ne lance jamais un processus STDIO orphelin. Le
réseau `backend` est interne ; seuls SearXNG et le MCP disposent aussi de l'egress. Crawl4AI reste
sans egress, sous l'utilisateur `appuser`, avec filesystem read-only, cache dédié et `/tmp` en
tmpfs. Les volumes `mcp-cache`, `searxng-cache` et `crawl4ai-data` sont séparés.

Le mode hybride reste le défaut de `mcp-search-net-services.cmd` : la façade MCP s'exécute depuis IntelliJ/Node portable et les deux dépendances sont liées uniquement à `127.0.0.1`.

## Mise à jour et désinstallation

Relancer l’installateur construit d'abord `.install-staging`, vérifie le package,
renomme l'application précédente puis active la nouvelle. Si l'activation
échoue, l'ancienne application est restaurée. La configuration, les données et
`.env` restent conservés.

La recette automatisée propre/mise à jour/désinstallation s'exécute sous
PowerShell 5.1 avec :

```powershell
$nodeRoot = Split-Path -Parent (Get-Command node).Source
.\scripts\test-installation.ps1 -NodeRuntimeSource $nodeRoot
```

```powershell
.\scripts\uninstall-user.ps1
.\scripts\uninstall-user.ps1 -KeepData
```

La première commande supprime toute l’installation et les volumes Compose canoniques après arrêt
des services. La seconde conserve explicitement configuration, données et volumes, tout en retirant
le programme. `-SkipServices` signifie que l'opérateur prend lui-même en charge les conteneurs et
volumes.

## Opérations catalogue installées

Les commandes installées n'exigent pas le checkout :

```powershell
& "$env:LOCALAPPDATA\mcp-search-net\bin\mcp-search-net-catalog.cmd" health
& "$env:LOCALAPPDATA\mcp-search-net\bin\mcp-search-net-catalog.cmd" verify
& "$env:LOCALAPPDATA\mcp-search-net\bin\mcp-search-net-catalog.cmd" backup --output catalog-backup.db
& "$env:LOCALAPPDATA\mcp-search-net\bin\mcp-search-net-maintain.cmd"
```

Les launchers fixent `MCP_CATALOG_PATH` à `data\catalog.db` sauf override explicite.
