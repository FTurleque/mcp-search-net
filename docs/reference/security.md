# Sécurité

## Frontières

Le serveur accepte uniquement des lectures Web et écrit seulement son cache SQLite local. Il n’exécute pas le contenu récupéré et n’accorde à Copilot aucun accès direct aux API ou fonctionnalités avancées de Crawl4AI.

La politique URL rejette les schémas autres que HTTP(S), les identifiants intégrés, les ports interdits, les noms locaux et les résolutions vers les plages loopback, privées, link-local, réservées ou documentaires.

`fetch_url` passe par une passerelle HTTP contrôlée. Avant chaque connexion, y compris chaque redirection, elle valide le protocole, les identifiants, le port, le nom et toutes les réponses DNS. La connexion est ensuite épinglée sur une adresse approuvée tout en conservant le nom TLS attendu. Cela ferme la fenêtre de DNS rebinding entre la validation MCP et la connexion cible.

## Défense en profondeur

- services liés à `127.0.0.1` ;
- jeton entre le MCP et Crawl4AI ;
- capacités Linux supprimées et `no-new-privileges` dans Compose ;
- SearXNG en lecture seule avec répertoire temporaire borné ;
- schémas Zod et budgets stricts ;
- cinq redirections, 10 Mio et 20 secondes maximum par téléchargement ;
- quatre téléchargements concurrents, temporisation par origine et respect de `robots.txt` ;
- requêtes SQLite préparées ;
- aucun log libre sur `stdout`.

## Frontière Crawl4AI

Crawl4AI ne télécharge plus directement la cible publique. En mode `auto`, il traite uniquement une URL `data:` construite à partir du HTML déjà contrôlé. Une politique d'egress du conteneur reste recommandée en défense supplémentaire, mais elle n'est plus la protection SSRF principale.

## Contenu malveillant

Scripts, styles, iframes, formulaires, navigation, publicités et contenu masqué sont retirés avant conversion. Le Markdown restant peut toujours contenir des instructions hostiles ou trompeuses : il doit rester traité comme une source, jamais comme une instruction prioritaire. Les métadonnées brutes du fournisseur et les secrets ne sont jamais renvoyés.
