# Utilisation

## `search_web`

Recherche des pages via SearXNG. Le serveur suréchantillonne les résultats, favorise les sources du registre officiel, limite les extraits et conserve URL, domaine, statut, score, moteur et métadonnées.

Exemples de demandes à Copilot :

- « Recherche la documentation officielle TypeScript sur `satisfies`. »
- « Trouve cinq sources récentes sur les transports MCP. »
- « Recherche en français les changements Node.js LTS. »

Les résultats du Web restent non fiables même lorsqu’ils sont marqués officiels : l’indicateur vient du registre local.

Utiliser `sourcePolicy: strict` pour ne conserver que les sources vérifiées, `prefer` pour les favoriser sans exclure le reste, ou `any` pour ne pas filtrer par statut. `allowedDomains` limite la recherche à des domaines choisis ; `excludedDomains` reste toujours prioritaire.

## `fetch_url`

Récupère une URL HTTP(S) publique connue via Crawl4AI, extrait du Markdown puis sélectionne les sections les plus proches des termes fournis. Le volume retourné est borné.

Exemples :

- « Récupère cette URL et garde les sections sur STDIO et les outils. »
- « Résume les sections d’installation de cette documentation. »

Le serveur refuse notamment les hôtes locaux, adresses privées, identifiants dans l’URL et ports non autorisés. Il ne remplit pas de formulaire, ne s’authentifie pas sur le Web et n’exécute aucun JavaScript fourni par l’appelant.

## `search_docs`

Recherche dans le catalogue documentaire local déjà ingéré. C'est l'outil à privilégier dans Copilot quand l'information est déjà dans la documentation indexée du projet.

Exemples de demandes à Copilot :

- « Utilise `search_docs` pour chercher `resources MCP V2` dans la documentation locale. »
- « Cherche dans le catalogue local les sections qui expliquent `catalog sync`. »
- « Utilise `search_docs` avec `maxResults` à 3 pour retrouver la doc sur la maintenance SQLite. »

Bonnes pratiques pour économiser le contexte :

1. Commencer par `search_docs` avant `search_web` ou `fetch_url`.
2. Limiter `maxResults` à 3 ou 5 pour une question normale.
3. Ajouter `sourceKey` quand la source documentaire est connue.
4. Demander une réponse basée sur les titres, URLs et snippets retournés.
5. Ne pas demander à Copilot de lire toutes les resources du catalogue.

`search_docs` retourne une réponse compacte : titre, URL, section pertinente, snippet et score. Il ne renvoie pas le contenu complet des sections.

## Resources MCP du catalogue

Les resources `mcp-search-net://catalog`, `mcp-search-net://sources`, `mcp-search-net://documents` et `mcp-search-net://sections` sont read-only. Elles servent surtout à l'inspection, au debug et aux clients MCP qui savent les parcourir proprement.

Pour économiser les tokens Copilot, éviter les demandes du type :

```text
Lis toutes les sections du catalogue.
```

Préférer :

```text
Utilise search_docs avec maxResults 3 pour trouver les sections pertinentes.
```

## Disponibilité

Le serveur MCP est lancé à la demande par Copilot. Les conteneurs Docker doivent déjà tourner pour les outils Web V1. Le cache SQLite est local au profil Windows et peut être supprimé sans perte fonctionnelle lorsque le MCP est arrêté. Le catalogue V2 est distinct du cache et doit être conservé.
