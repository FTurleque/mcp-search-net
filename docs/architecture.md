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

## Flux

`search_web` valide l’entrée, consulte le cache, interroge SearXNG, normalise et classe les résultats, puis applique le budget de sortie. `fetch_url` valide l’URL et sa résolution DNS, consulte le cache, appelle la façade Crawl4AI, sélectionne les sections Markdown et limite la réponse.

Les futurs ports documentaires V2 peuvent être ajoutés sans modifier le domaine V1, mais aucune indexation, synchronisation ou recherche multi-document n’est implémentée ici.
