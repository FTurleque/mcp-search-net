# mcp-search-net

Local MCP Web server for GitHub Copilot in IntelliJ IDEA. It exposes only:

- `search_web`: searches through a local SearXNG instance and ranks official sources first;
- `fetch_url`: extracts one public URL through Crawl4AI, selects relevant Markdown sections and limits the returned content.

The server contains no internal LLM and requires no commercial API.

## Prerequisites

- Node.js 24 LTS
- npm
- Docker with Docker Compose
- at least 4 GB of memory available to Docker

## Install and build

```powershell
npm install
npm run check
```

## Start local Web services

```powershell
Copy-Item .env.example .env
docker compose up -d
docker compose ps
```

SearXNG is bound to `127.0.0.1:8888`; Crawl4AI is bound to `127.0.0.1:11235`.
The development token is local-only. Change it before sharing either port.

## Run the MCP server

```powershell
$env:CRAWL4AI_API_TOKEN='mcp-search-local-development-token'
npm run build
node dist/bootstrap/main.js
```

The process intentionally prints nothing except MCP protocol messages on stdout. Structured logs go to stderr.

## IntelliJ IDEA / GitHub Copilot

In Copilot Chat, use **Configure your MCP server** then **Add MCP Tools**. Add a local server to the generated `mcp.json`:

```json
{
  "servers": {
    "mcp-search-net": {
      "command": "node",
      "args": ["I:/Documents/mcp-search-web/dist/bootstrap/main.js"],
      "env": {
        "MCP_SEARCH_CONFIG": "I:/Documents/mcp-search-web/config/application.yml",
        "CRAWL4AI_API_TOKEN": "mcp-search-local-development-token"
      }
    }
  }
}
```

Adapt the absolute paths to the final repository location. The project currently lives in `mcp-search-web`; renaming it does not affect the code.

## Configuration

- `config/application.yml`: endpoints, cache, limits and URL policy.
- `config/official-sources.yml`: registry used to mark and boost official documentation.
- `config/searxng/settings.yml`: explicitly enables the SearXNG JSON response format.
- `MCP_SEARCH_CONFIG`: overrides the application configuration path.
- `CRAWL4AI_API_TOKEN`: overrides the local fallback token.

Invalid required configuration stops startup with a structured error on stderr.

## Security boundaries

- only HTTP(S) URLs on allowed ports are accepted;
- DNS results resolving to loopback, private, link-local, documentation or reserved networks are rejected;
- URL credentials and local hostnames are rejected;
- Crawl4AI receives only one URL and no executable/browser configuration from MCP callers;
- fetched Web content is untrusted data and is never executed;
- cache writes are limited to the configured local SQLite file.

DNS rebinding cannot be eliminated solely by pre-resolution because Crawl4AI resolves the URL in a separate browser process. Keep Crawl4AI local, authenticated and isolated; production deployments should add egress firewall rules.

## Commands

| Command         | Purpose                                       |
| --------------- | --------------------------------------------- |
| `npm run dev`   | Run from TypeScript during development        |
| `npm run build` | Compile production JavaScript                 |
| `npm start`     | Run compiled MCP server                       |
| `npm test`      | Run Vitest                                    |
| `npm run lint`  | Run ESLint                                    |
| `npm run check` | Typecheck, lint, format-check, test and build |

## Scope

SQLite is a cache only. Document catalogues, local indexing, FTS/BM25 multi-document search, synchronization and embeddings remain out of scope for V1.
