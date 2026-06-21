# Sécurité

## Frontières

Le serveur accepte uniquement des lectures Web et écrit seulement son cache SQLite local. Il n’exécute pas le contenu récupéré et n’accorde à Copilot aucun accès direct aux API ou fonctionnalités avancées de Crawl4AI.

La politique URL rejette les schémas autres que HTTP(S), les identifiants intégrés, les ports interdits, les noms locaux et les résolutions vers les plages loopback, privées, link-local, réservées ou documentaires. Les redirections restent contrôlées par l’adaptateur d’extraction.

## Défense en profondeur

- services liés à `127.0.0.1` ;
- jeton entre le MCP et Crawl4AI ;
- capacités Linux supprimées et `no-new-privileges` dans Compose ;
- SearXNG en lecture seule avec répertoire temporaire borné ;
- schémas Zod et budgets stricts ;
- requêtes SQLite préparées ;
- aucun log libre sur `stdout`.

## Limite SSRF importante

Le MCP résout et contrôle le nom avant l’appel, mais Crawl4AI effectue sa propre résolution dans un autre processus. Un changement DNS entre les deux étapes ne peut pas être totalement éliminé au niveau applicatif. Garder Crawl4AI local et ajouter des règles de sortie réseau si l’environnement requiert une isolation forte.

## Contenu malveillant

Le Markdown retourné peut contenir des instructions hostiles ou trompeuses. Il doit rester traité comme une source, jamais comme une instruction prioritaire. Les métadonnées et URL sont conservées pour permettre l’attribution et la vérification.
