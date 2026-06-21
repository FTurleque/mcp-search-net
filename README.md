# mcp-search-net

Serveur MCP Web local pour GitHub Copilot dans IntelliJ IDEA. La V1 expose uniquement :

- `search_web`, avec priorité aux documentations officielles ;
- `fetch_url`, avec extraction Markdown ciblée et budget de contenu.

Le serveur utilise SearXNG, Crawl4AI et un cache SQLite. Il n’embarque aucun LLM et ne requiert aucune API commerciale.

## Installation Windows recommandée

Prérequis : Windows 10/11, Docker Desktop et PowerShell. Node.js est téléchargé dans l’espace utilisateur ; aucun droit administrateur ni `PATH` système n’est nécessaire.

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\install-user.ps1 -StartServices
```

L’installation stable se trouve dans :

```text
%LOCALAPPDATA%\mcp-search-net
```

Le fichier `%LOCALAPPDATA%\mcp-search-net\mcp.json.example` contient la déclaration Copilot avec le chemin absolu correct. Voir [la procédure IntelliJ/Copilot](docs/getting-started/intellij-copilot.md).

Deux configurations partagées sont disponibles dans IntelliJ : `MCP - Install user (Windows)` et `MCP - Install and run (Windows)`.

## Développement

Le dépôt cible Node.js 24 LTS et npm :

```powershell
npm ci
npm run check
docker compose up -d
npm run dev
```

SearXNG écoute sur `127.0.0.1:8888` et Crawl4AI sur `127.0.0.1:11235`. Le processus MCP réserve strictement `stdout` au protocole et écrit ses logs structurés sur `stderr`.

## Documentation

Le [sommaire de la documentation](docs/README.md) couvre l’installation, IntelliJ/Copilot, l’utilisation, la configuration, l’architecture, les contrats des outils, le développement, les tests, la sécurité et le dépannage.

## Périmètre V1

SQLite sert uniquement de cache. Les catalogues documentaires, l’indexation locale, FTS/BM25, la synchronisation et les embeddings restent hors périmètre V1.
