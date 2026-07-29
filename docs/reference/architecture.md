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
- `DnsResolver` : résolution complète et injectable de toutes les adresses ;
- `Clock` : temps injectable pour les TTL et tests.
- `Telemetry` : événements structurés corrélés par `requestId`.
- `Logger` : diagnostics structurés et télémétrie sur `stderr`.

## Flux

`search_web` normalise l'entrée avant de construire sa clé de cache, consulte le cache, interroge SearXNG, tente l'anglais si la langue demandée ne retourne rien, normalise les URL, classifie et déduplique les sources, applique les filtres/politiques puis le budget de sortie. Il ne récupère jamais le contenu des pages trouvées. `fetch_url` valide l’URL et sa résolution DNS, consulte le cache, télécharge via la passerelle sécurisée, sélectionne les sections Markdown et limite la réponse.

Le cache possède uniquement les tables `search_cache`, `content_cache` et `schema_migrations`. Les contenus conservent URL, type, Markdown nettoyé, sections, statut HTTP, date, ETag, Last-Modified et hash. Une entrée expirée reste disponible pendant la rétention stale : si le fournisseur échoue, elle produit `STALE_FALLBACK` et `STALE_CACHE_USED`. Sans cache, les outils continuent avec `DISABLED`.

## Catalogue documentaire V2

La V2 ajoute des ports applicatifs de catalogue sans modifier le domaine V1. SQLite implémente les
transactions documentaires, l'index FTS5, les recherches par identifiant et les pages filtrées par
source, langue et statut. Les adaptateurs MCP ne dépendent jamais directement de SQLite : ils
appellent le port `CatalogRepository` ou les cas d'usage.

Les collections MCP sont bornées à 20 éléments et les outils n'acceptent pas plus de 50 documents
par page. Les lectures par identifiant utilisent des requêtes ciblées, tandis que les anciennes
méthodes de chargement global restent réservées aux opérations CLI internes et aux comparaisons de
benchmark. La migration `C008` ajoute les index de pagination mesurés pour la langue et les filtres
composés.
