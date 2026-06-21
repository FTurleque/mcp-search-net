# Contrats des outils MCP

## `search_web`

Entrées conceptuelles : termes obligatoires, nombre de résultats borné, langue et période optionnelles. Sortie structurée : requête, résultats et métadonnées. Chaque résultat conserve au minimum son URL, son titre, son extrait et son statut de source officielle lorsqu’il est connu.

Le nombre demandé ne peut pas dépasser la limite applicative. La langue et la période dépendent aussi des moteurs SearXNG actifs ; elles constituent des filtres, pas une garantie absolue.

## `fetch_url`

Entrées conceptuelles : URL publique obligatoire, termes de pertinence optionnels et budget de caractères borné. Sortie structurée : URL finale, titre, Markdown sélectionné, liens conservés et métadonnées d’extraction/cache.

Une URL peut être refusée avant tout accès réseau. Une page dynamique peut nécessiter plus de temps qu’une page HTML statique. Les PDF textuels sont possibles selon les capacités de Crawl4AI ; l’OCR est hors périmètre.

## Annotations et erreurs

Les outils sont déclarés en lecture seule et non destructifs. Les erreurs de validation, sécurité, dépendance indisponible et délai sont converties en erreurs MCP lisibles, tandis que les détails techniques sont journalisés sur `stderr`.

Le serveur n’expose aucune option Crawl4AI permettant scripts arbitraires, hooks navigateur, fichiers locaux, proxy fourni par l’appelant, cookies, authentification ou configuration LLM.
