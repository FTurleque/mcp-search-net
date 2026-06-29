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

Le script télécharge Node.js 24.17.0 LTS depuis `nodejs.org`, valide et compile le projet, installe uniquement les dépendances de production, puis démarre SearXNG et Crawl4AI. Il ne modifie ni le `PATH` système, ni le registre Windows.

Une installation existante conserve `config\application.yml`, `config\official-sources.yml`, `config\searxng\settings.yml` et `data`. Les nouvelles valeurs de référence sont placées à côté avec le suffixe `.default`.

## Arborescence installée

```text
%LOCALAPPDATA%\mcp-search-net\
├── app\                 application compilée et dépendances de production
├── bin\                 lanceur MCP et commande Docker
├── config\              configuration persistante
├── data\                cache SQLite
├── docs\                copie de cette documentation
├── runtime\              Node.js portable
├── compose.yaml         mode complet, services internes
├── compose.hybrid.yaml  compatibilité des installations antérieures
├── mcp.json.example
├── mcp.container.json.example
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

Utiliser `mcp.container.json.example` dans Copilot. Le réseau `backend` est interne ; seul SearXNG et le MCP disposent aussi du réseau d'egress nécessaire. Les volumes `mcp-cache`, `searxng-cache` et `crawl4ai-data` sont séparés.

Le mode hybride reste le défaut de `mcp-search-net-services.cmd` : la façade MCP s'exécute depuis IntelliJ/Node portable et les deux dépendances sont liées uniquement à `127.0.0.1`.

## Mise à jour et désinstallation

Relancer l’installateur effectue une mise à jour en conservant les données utilisateur.

```powershell
.\scripts\uninstall-user.ps1
.\scripts\uninstall-user.ps1 -KeepData
```

La première commande supprime toute l’installation. La seconde conserve la configuration et le cache.
