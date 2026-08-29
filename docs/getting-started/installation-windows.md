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
`config\application.docker.yml`, `config\searxng\settings.yml` et `data`. Les nouvelles valeurs de
référence sont placées à côté avec le suffixe `.default`.

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

Le setup et le ZIP utilisent le même moteur `scripts\update-installation.ps1`. Le setup n’écrase
jamais directement le répertoire installé : il extrait le ZIP exact de release dans un dossier
temporaire puis demande au moteur de mise à jour d’activer ce payload.

Le post-install peut configurer les clients MCP détectés. Les règles d’ownership sont strictes :

- une entrée `mcp-search-net` préexistante et non gérée est préservée ;
- une entrée créée ou déjà suivie par l’installateur est marquée `managed` ;
- une entrée préexistante est enregistrée `preexisting` sans être remplacée ;
- la désinstallation supprime uniquement les entrées `managed` ;
- un JSON existant vide ou invalide provoque un échec fermé pour ce client : le fichier n’est pas
  remplacé par une configuration vide ;
- un backup est créé avant chaque modification gérée.

L’état d’ownership est conservé dans `mcp-client-integrations.json`.

## Politique globale d'agent (Global Agent Policy)

En complément de l'enregistrement MCP ci-dessus, le post-install installe une courte politique
« utilise mcp-search-net automatiquement quand c'est pertinent » dans le fichier d'instructions
**global, propre à l'utilisateur Windows**, de chaque client pris en charge. Cette politique est
strictement additive : elle ne remplace jamais l'enregistrement MCP existant et ne modifie aucun
paramètre de sécurité (permissions, sandbox, autorisation d'outils) des clients concernés.

**mcp-search-net n'installe jamais cette politique dans un dépôt applicatif.** Aucun fichier
`CLAUDE.md`, `AGENTS.md`, `.github\copilot-instructions.md` ou `.github\instructions\` d'un dépôt
ouvert par l'utilisateur n'est jamais créé ni modifié par cette fonctionnalité — uniquement les
chemins globaux ci-dessous, résolus depuis `USERPROFILE` / `LOCALAPPDATA` / `CODEX_HOME` /
`COPILOT_HOME`, jamais depuis le répertoire courant ou un dépôt Git.

| Client                   | Fichier global                                                                                  |
| ------------------------ | ----------------------------------------------------------------------------------------------- |
| Claude Code              | `%USERPROFILE%\.claude\CLAUDE.md`                                                               |
| Codex                    | `$CODEX_HOME\AGENTS.md`, sinon `%USERPROFILE%\.codex\AGENTS.md`                                 |
| GitHub Copilot CLI       | `$COPILOT_HOME\copilot-instructions.md`, sinon `%USERPROFILE%\.copilot\copilot-instructions.md` |
| GitHub Copilot JetBrains | `%LOCALAPPDATA%\github-copilot\intellij\global-copilot-instructions.md`                         |

Claude Desktop n'est pas concerné par cette fonctionnalité : seul son enregistrement MCP existant
est géré.

Le contenu géré est délimité par les marqueurs `<!-- BEGIN MCP-SEARCH-NET GLOBAL POLICY -->` et
`<!-- END MCP-SEARCH-NET GLOBAL POLICY -->`, identiques dans les quatre fichiers. Les mêmes règles
d'ownership que pour l'enregistrement MCP s'appliquent au bloc géré :

- le contenu de l'utilisateur en dehors du bloc n'est jamais modifié ;
- une réinstallation identique est un NO-OP (bloc strictement identique, aucune écriture) ;
- une modification manuelle du contenu à l'intérieur du bloc est détectée par empreinte et bloque
  la mise à jour de ce fichier (`MCP_CONFIG_MANAGED_POLICY_DRIFT`) plutôt que de l'écraser ;
- des marqueurs ambigus (BEGIN sans END, blocs multiples, etc.) font échouer la configuration de ce
  fichier sans tenter de le réparer (`MCP_CONFIG_MANAGED_POLICY_MARKERS_INVALID`) ;
- la désinstallation retire uniquement le bloc géré, et ne supprime le fichier entier que si
  mcp-search-net l'avait lui-même créé et qu'il ne resterait aucun contenu utilisateur après retrait
  du bloc.

## Mise à jour sur place

Pour passer d’une version installée à une version plus récente, **il n’est pas nécessaire de
désinstaller mcp-search-net**. Télécharger le nouveau `mcp-search-net-<version>-windows-x64-setup.exe`
et l’exécuter normalement. L’`AppId` Inno reste stable et le setup reprend automatiquement le
répertoire de l’installation existante.

La mise à jour fonctionne de la même manière avec le ZIP : extraire la nouvelle release puis relancer
`install.ps1` vers le même `InstallRoot`.

Le moteur prépare la nouvelle version dans `.install-staging`, écrit un journal dans
`.install-rollback\transaction.json`, puis remplace les surfaces programme gérées :

- `app` ;
- `bin` ;
- `runtime` ;
- `scripts` ;
- `docker` ;
- les fichiers racine gérés (`compose*.yaml`, manifeste de build, licence et notices).

Les anciens fichiers programme absents de la nouvelle release disparaissent donc réellement : une
mise à jour n’est pas une simple copie par-dessus l’ancienne version.

Les éléments persistants sont conservés :

- `.env` et les secrets locaux ;
- `data` et toutes les bases SQLite ;
- `config\application.yml` ;
- `config\application.docker.yml` ;
- `config\official-sources.yml` ;
- `config\searxng\settings.yml` ;
- `mcp-client-integrations.json` et les backups de configuration.

Les fichiers `*.default` sont, eux, remplacés par les valeurs de référence de la nouvelle version.
Cela permet de comparer une configuration personnalisée à la configuration courante sans perdre les
choix de l’utilisateur.

Avant l’activation, les processus serveur MCP qui utilisent l’installation courante sont arrêtés afin
d’éviter les verrous Windows. Si une activation échoue, les composants déjà remplacés sont retirés et
la version précédente est restaurée. Si Windows ou le setup est interrompu au milieu de l’activation,
le journal restant est détecté au prochain lancement et la transaction incomplète est restaurée avant
de tenter une nouvelle mise à jour.

Le setup qualifié exécute en CI une installation réelle puis une seconde installation sur le même
dossier. La recette vérifie la conservation de `.env`, de la configuration et des données, la
suppression d’un fichier programme obsolète et le redémarrage du serveur MCP via sa sonde STDIO.

## Arborescence installée

```text
<installation>\
├── app\                 application compilée et dépendances runtime
│   ├── migrations\
│   ├── catalog-migrations\
│   └── history-migrations\
├── bin\                 launchers MCP, Docker et opérations catalogue
├── config\              configuration persistante
├── data\                cache, catalogue et historique SQLite persistants
├── runtime\             Node.js portable
│   └── node-v24.18.0-win-x64\
├── scripts\             configuration et moteur de mise à jour
├── docker\              sources Compose/Docker distribuées
├── .env                  secrets fournisseurs générés localement
├── compose.yaml
├── compose.hybrid.yaml
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

## Désinstallation

La désinstallation retire les composants programme gérés. Par défaut elle conserve la configuration
et les données persistantes. En mode interactif, le setup demande explicitement si ces données doivent
également être supprimées ; le choix destructif n’est jamais implicite.

Pour l’installation historique depuis les sources :

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
