# Security checklist

## Network and SSRF

- Allow HTTP(S) only; reject credentials, unexpected ports, localhost, local names, and non-public IPv4/IPv6 ranges.
- Resolve every hostname and reject the request if any returned address is unsafe.
- Validate protocol, hostname, DNS answers, and address before every redirect connection.
- Consider DNS rebinding across the MCP/Crawl4AI process boundary.
- Enforce redirect, timeout, response-size, and concurrency limits server-side.
- Keep SearXNG and Crawl4AI inaccessible to the agent except through typed adapters.

## Untrusted content

- Treat provider JSON and extracted content as data, never instructions.
- Never execute page-provided JavaScript, hooks, commands, forms, cookies, credentials, proxies, or file paths.
- Remove scripts, invisible content, interactive elements, repeated navigation, and irrelevant chrome.
- Preserve source URLs and warnings so the client can verify provenance.

## Secrets and logging

- Keep authorization values and environment variables out of responses, logs, fixtures, and snapshots.
- Recursively redact keys such as token, secret, password, cookie, authorization, and API key.
- Return stable public error codes; keep implementation details and stack traces private.
- Keep stdout reserved for MCP JSON-RPC and write structured diagnostics to stderr.

## Supply chain and deployment

- Keep lockfiles committed and use `npm ci`.
- Pin container versions or digests and review intentional upgrades.
- Use least privilege, dropped capabilities, read-only filesystems where possible, and loopback/internal networking.
- Do not weaken absolute limits through configuration or tool arguments.

## Audit output

For every finding include severity, evidence, reachable failure/exploit path, affected requirement, remediation, and a regression test. Distinguish confirmed findings from hypotheses.
