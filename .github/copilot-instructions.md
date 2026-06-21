# Project instructions

- Keep the domain independent from MCP, SearXNG, Crawl4AI, SQLite, Docker, YAML and Zod.
- V1 exposes exactly two MCP tools: `search_web` and `fetch_url`.
- Never write application logs or free-form text to stdout; MCP STDIO owns stdout.
- Treat URLs and fetched content as untrusted. Preserve the SSRF policy and output budgets.
- Never pass caller-provided JavaScript, hooks, cookies, proxy settings, file paths or LLM configuration to Crawl4AI.
- Do not implement V2 document indexing, catalogues, FTS, embeddings or synchronization in V1.
