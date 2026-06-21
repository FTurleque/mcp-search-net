# Project map

## Architecture

- `src/domain`: models, errors, URL-independent ranking and content-selection rules. No MCP, HTTP, SQLite, YAML, Docker, SearXNG, or Crawl4AI imports.
- `src/application`: use cases and ports. Orchestrates domain behavior through interfaces.
- `src/infrastructure`: SearXNG, Crawl4AI, SQLite, DNS/URL security, configuration, time, and structured logging.
- `src/presentation/mcp`: MCP schemas, handlers, common response envelope, and compact text fallbacks.
- `src/bootstrap`: dependency composition, STDIO connection, lifecycle, and shutdown.
- `tests`: mirrors the source layers; live E2E tests are explicitly opt-in.
- `config`: application profiles, official-source registry, and SearXNG settings.
- `docs`: getting started, reference, operations, development, and planning evidence.

## Stable boundaries

- V1 exposes exactly `search_web` and `fetch_url`.
- SQLite is a cache, not a permanent document index.
- The server uses no internal LLM and no mandatory paid API.
- `search_web` discovers URLs and never fetches result pages.
- `fetch_url` reads one known public URL and never performs a search or autonomous crawl.
- MCP stdout contains JSON-RPC only.

## Commands

```powershell
npm run check:runtime
npm run typecheck
npm run lint
npm run format:check
npm run build
npm test
npm run check
docker compose config --quiet
docker compose ps
```

Node.js 24 is mandatory. Use focused Vitest paths during iteration and `npm run check` before completion.

## Primary references

- Roadmap: `docs/planning/roadmap-v1-operationnelle.md`
- Tool contracts: `docs/reference/tools.md`
- Architecture: `docs/reference/architecture.md`
- Security: `docs/reference/security.md`
- Testing: `docs/development/testing.md`
- Troubleshooting: `docs/operations/troubleshooting.md`
