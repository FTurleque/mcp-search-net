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

## Disponibilité

Le serveur MCP est lancé à la demande par Copilot. Les conteneurs Docker doivent déjà tourner. Le cache SQLite est local au profil Windows et peut être supprimé sans perte fonctionnelle lorsque le MCP est arrêté.
