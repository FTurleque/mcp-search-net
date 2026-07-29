# Observabilité

Tous les diagnostics sont des objets JSON écrits sur `stderr`. `stdout` est réservé au protocole MCP JSON-RPC.

Événements stables :

- `server_started` ;
- `tool_call_started`, `tool_call_completed`, `tool_call_failed` ;
- `cache_hit`, `cache_miss` ;
- `provider_called`, `provider_failed` ;
- `url_blocked`, `content_truncated`, `configuration_invalid`.
- `catalog_maintenance_started`, `catalog_maintenance_completed`,
  `catalog_maintenance_failed` ;
- `file_lease_lock_stale_recovered`,
  `file_lease_lock_release_owner_mismatch`.

Selon l'événement, les champs incluent `requestId`, outil, durée, domaine, statut, cache, tailles et nombres de résultats/sections. Les clés sensibles sont expurgées récursivement. Les contenus récupérés, variables d'environnement, autorisations, cookies, secrets et stacks ne sont jamais journalisés.

Les réponses MCP transportent séparément la provenance publique et la marque
`EXTERNAL_UNTRUSTED_CONTENT`; les journaux ne recopient jamais le contenu externe
pour fournir cette traçabilité.

Exemple :

```json
{
  "timestamp": "2026-06-21T22:00:00.000Z",
  "level": "info",
  "event": "cache_hit",
  "requestId": "…",
  "tool": "fetch_url",
  "cache": "content",
  "stale": true
}
```
