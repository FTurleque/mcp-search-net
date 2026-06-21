# Architecture

La V1 suit une architecture hexagonale simplifiée :

```text
src/
├── domain/          modèles, règles de classement et sélection de contenu
├── application/     cas d’usage et ports
├── infrastructure/ adaptateurs SearXNG, Crawl4AI, SQLite, YAML, DNS et horloge
├── presentation/    outils et transport MCP STDIO
└── bootstrap/       composition et démarrage
```

Le domaine ne dépend ni du SDK MCP, ni de SearXNG, Crawl4AI, SQLite, Docker, YAML ou Zod. Les dépendances pointent vers l’intérieur : la présentation appelle les cas d’usage, et les adaptateurs implémentent les ports applicatifs.

## Ports V1

- `SearchProvider` : recherche brute auprès d’un moteur ;
- `ContentFetcher` : extraction contrôlée d’une URL ;
- `CacheRepository` : cache des recherches et contenus ;
- `OfficialSourceRegistry` : identification et priorité des sources ;
- `UrlSecurityPolicy` : validation SSRF avant extraction ;
- `Clock` : temps injectable pour les TTL et tests.
- `Telemetry` : événements structurés corrélés par `requestId`.

## Flux

`search_web` normalise l'entrée avant de construire sa clé de cache, consulte le cache, interroge SearXNG, tente l'anglais si la langue demandée ne retourne rien, normalise les URL, classifie et déduplique les sources, applique les filtres/politiques puis le budget de sortie. Il ne récupère jamais le contenu des pages trouvées. `fetch_url` valide l’URL et sa résolution DNS, consulte le cache, télécharge via la passerelle sécurisée, sélectionne les sections Markdown et limite la réponse.

Le cache possède des espaces typés `search`, `content` et `temporary-error`. Les contenus conservent URL, type, Markdown nettoyé, sections, statut HTTP, date, ETag, Last-Modified et hash. Une entrée expirée reste disponible pendant la rétention stale : si le fournisseur échoue, elle produit `STALE_FALLBACK` et `STALE_CACHE_USED`. Sans cache, les outils continuent avec `DISABLED`.

Les futurs ports documentaires V2 peuvent être ajoutés sans modifier le domaine V1, mais aucune indexation, synchronisation ou recherche multi-document n’est implémentée ici.
