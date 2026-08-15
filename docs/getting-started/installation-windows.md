# Installation Windows

## Prérequis

- Windows 10 ou 11 64 bits ;
- PowerShell 5.1 ou supérieur ;
- Docker Desktop avec Docker Compose ;
- environ 4 Go de mémoire disponibles pour Docker.

L’installation utilisateur ne demande pas de droits administrateur. Le mode historique depuis les
sources cible :

```text
%LOCALAPPDATA%\mcp-search-net
```

Le setup/ZIP de release peut installer sous un autre dossier utilisateur ; les launchers utilisent
`MCP_SEARCH_HOME` pour rester indépendants du chemin choisi.

## Installation depuis les sources

Depuis la racine du dépôt :

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\install-user.ps1 -StartServices
```

Le script utilise Node.js 24.18.0, vérifie le SHA-256 officiel avant extraction, exige une signature
Authenticode OpenJS valide, puis écrit `runtime\node-runtime-proof.json`. Il valide et compile le
projet, construit un staging applicatif contenant les trois familles de migrations ainsi que
`.npmrc`, exige `strict-allow-scripts=true`, installe uniquement les dépendances de production puis
démarre SearXNG et Crawl4AI. Un runtime téléchargé invérifiable est supprimé et jamais activé.

À la première installation, des secrets aléatoires sont générés dans `.env` pour SearXNG et
Crawl4AI. Ce fichier n’est pas remplacé lors d’une mise à jour et ne doit pas être commité.

Une installation existante conserve `config\application.yml`, `config\official-sources.yml`,
`config\searxng\settings.yml` et `data`. Les nouvelles valeurs de référence sont placées à côté avec
le suffixe `.default`.

## Setup et ZIP de release

Le workflow Windows peut produire :

```text
mcp-search-net-<version>-windows-x64-setup.exe
mcp-search-net-<version>-windows-x64-setup.exe.sha256
mcp-search-net-<version>-windows-x64.zip
mcp-search-net-<version>-windows-x64.zip.sha256
```

Le runtime Node.js 24.18.0 est embarqué dans ces artefacts. Le pipeline refuse de publier si la
version demandée diffère de `package.json`, de `package-lock.json` ou de la version réellement
embarquée. Inno Setup est figé sur la version 6.7.3 dans le workflow de publication.

Le post-install peut configurer les clients MCP détectés. Les règles d’ownership sont strictes :

- une entrée `mcp-search-net` préexistante et non gérée est préservée ;
- une entrée créée ou déjà suivie par l’installateur est marquée `managed` ;
- une entrée préexistante est enregistrée `preexisting` sans être remplacée ;
- la désinstallation supprime uniquement les entrées `managed` ;
- un JSON existant vide ou invalide provoque un échec fermé pour ce client : le fichier n’est pas
  remplacé par une configuration vide ;
- un backup est créé avant chaque modification gérée.

L’état d’ownership est conservé dans `mcp-client-integrations.json`.

## Arborescence installée

```text
<installation>\
├── app\                 application compilée, dépendances et migrations runtime
├── bin\                 launchers MCP, Docker et opérations catalogue
├── config\              configuration persistante
├── data\                cache, catalogue et historique SQLite persistants
├── runtime\             Node.js portable
│   └── node-v24.18.0-win-x64\
├── .env                  secrets fournisseurs générés localement
├── .npmrc                politique npm strict-allow-scripts
├── compose.yaml
├── compose.hybrid.yaml
├── migrations\
├── catalog-migrations\
├── history-migrations\
├── mcp.json.example
├── mcp.container.json.example
├── mcp-client-integrations.json
└── BUILD-MANIFEST.json
```

Le lanceur stable est `bin\mcp-search-net.cmd`. La sonde de packaging vérifie également que
`list_search_history` démarre avec `enabled=true` et `available=true`, afin qu’une migration
historique manquante ne puisse pas être masquée par le comportement fail-open du serveur.

## Services

Pour l’installation historique sous `%LOCALAPPDATA%` :

```powershell
& "$env:LOCALAPPDATA\mcp-search-net\bin\mcp-search-net-services.cmd" up -d
& "$env:LOCALAPPDATA\mcp-search-net\bin\mcp-search-net-services.cmd" ps
& "$env:LOCALAPPDATA\mcp-search-net\bin\mcp-search-net-services.cmd" down
```

SearXNG écoute uniquement sur `127.0.0.1:8888` et Crawl4AI sur `127.0.0.1:11235` dans le mode
hybride.

Le projet Compose canonique de l’installation utilisateur est `mcp-search-net`. Les conteneurs
attendus sont donc `mcp-search-net-searxng-1` et `mcp-search-net-crawl4ai-1`.

La désinstallation du setup arrête explicitement la stack avec
`docker compose -p mcp-search-net down --remove-orphans` lorsque Docker est disponible.

## Posture Docker

Le réseau `backend` est interne. SearXNG et le serveur MCP disposent du réseau `egress` lorsque
nécessaire. Crawl4AI reste uniquement sur `backend` et ne dispose d’aucun egress public direct.

- SearXNG : utilisateur `977:977`, filesystem read-only, `cap_drop: ALL`,
  `no-new-privileges` et tmpfs limité ;
- Crawl4AI : utilisateur `appuser`, `cap_drop: ALL`, `no-new-privileges` et tmpfs dédiés. Son
  filesystem n’est pas déclaré read-only car Chromium/Playwright écrit pendant son initialisation ;
- serveur MCP conteneurisé : utilisateur `node`, filesystem read-only, `cap_drop: ALL`,
  `no-new-privileges`, volume `.data` dédié.

Le service MCP appartient au profil explicite `stdio`, donc un simple `docker compose up -d` ne
lance pas de processus STDIO orphelin.

## Mise à jour et désinstallation depuis les sources

Relancer l’installateur historique construit d’abord `.install-staging`, vérifie le package, renomme
l’application précédente puis active la nouvelle. Si l’activation échoue, l’ancienne application est
restaurée. La configuration, les données et `.env` restent conservés.

La recette automatisée propre/mise à jour/désinstallation s’exécute sous PowerShell 5.1 avec :

```powershell
$nodeRoot = Split-Path -Parent (Get-Command node).Source
.\scripts\test-installation.ps1 -NodeRuntimeSource $nodeRoot
```

Puis :

```powershell
.\scripts\uninstall-user.ps1
.\scripts\uninstall-user.ps1 -PurgeData
```

La première commande retire le programme mais conserve par défaut configuration, données et volumes.
La seconde exige explicitement la purge complète des données et volumes avec `-PurgeData`. Le switch
historique `-KeepData` reste accepté comme alias explicite du comportement sûr par défaut ; il est
mutuellement exclusif avec `-PurgeData`. `-SkipServices` signifie que l’opérateur prend lui-même en
charge les conteneurs et volumes.

## Opérations catalogue installées

Les commandes installées n’exigent pas le checkout :

```powershell
& "$env:LOCALAPPDATA\mcp-search-net\bin\mcp-search-net-catalog.cmd" health
& "$env:LOCALAPPDATA\mcp-search-net\bin\mcp-search-net-catalog.cmd" verify
& "$env:LOCALAPPDATA\mcp-search-net\bin\mcp-search-net-catalog.cmd" backup --output catalog-backup.db
& "$env:LOCALAPPDATA\mcp-search-net\bin\mcp-search-net-maintain.cmd"
```

Les launchers fixent `MCP_CATALOG_PATH` à `data\catalog.db` sauf override explicite.
