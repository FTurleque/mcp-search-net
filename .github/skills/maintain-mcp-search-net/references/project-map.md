# Carte du projet

## Architecture

- `src/domain` : modèles, erreurs, règles de ranking et de sélection de contenu indépendantes des URLs. Aucun import MCP, HTTP, SQLite, YAML, Docker, SearXNG ou Crawl4AI.
- `src/application` : use cases et ports. Orchestre le comportement domain via des interfaces.
- `src/infrastructure` : SearXNG, Crawl4AI, SQLite, sécurité DNS/URL, configuration, horloge et journalisation structurée.
- `src/presentation/mcp` : schémas MCP, handlers, enveloppe de réponse commune et fallbacks texte compacts.
- `src/bootstrap` : composition des dépendances, connexion STDIO, cycle de vie et arrêt.
- `tests` : reflète les couches sources ; les tests E2E live sont explicitement opt-in.
- `config` : profils d'application, registre des sources officielles et paramètres SearXNG.
- `docs` : démarrage, référence, opérations, développement et preuves de planification.

## Frontières stables

- Le sous-contrat V1 expose exactement `search_web` et `fetch_url`; le serveur complet ajoute `search_docs`, `list_docs` et `read_doc_section` en lecture seule.
- `cache.sqlite` est un cache Web ; `catalog.db` est le catalogue V2 persistant séparé et son FTS est dérivé.
- Le serveur n'utilise aucun LLM interne ni API payante obligatoire.
- `search_web` découvre des URLs et ne télécharge jamais les pages de résultats.
- `fetch_url` lit une seule URL publique connue et n'effectue jamais de recherche ni de crawl autonome.
- stdout MCP contient uniquement du JSON-RPC.

## Commandes

```powershell
npm run check:runtime
npm run typecheck
npm run lint
npm run format:check
npm run build
npm test
npm run check
npm run docs:check
docker compose config --quiet
docker compose ps
```

Node.js 24 est obligatoire. Utiliser des chemins Vitest ciblés pendant l'itération et `npm run check` avant de terminer.

## Références principales

- Roadmap : `docs/planning/roadmap-v1-operationnelle.md`
- Contrats des outils : `docs/reference/tools.md`
- Architecture : `docs/reference/architecture.md`
- Sécurité : `docs/reference/security.md`
- Tests : `docs/development/testing.md`
- Dépannage : `docs/operations/troubleshooting.md`
