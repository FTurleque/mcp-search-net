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

Crawl4AI ne télécharge plus directement la cible publique. En mode `auto`, il traite uniquement un document `raw://` construit à partir du HTML déjà contrôlé. Scripts, styles, éléments de ressources, métadonnées de navigation, attributs d'événement et URL de chargement sont supprimés avant ce rendu. Le conteneur rejoint le bridge `egress` uniquement pour rendre son port disponible sur le loopback Windows ; l'API reste liée à `127.0.0.1`, protégée par token et n'est jamais exposée comme outil MCP.

## Contenu malveillant

Scripts, styles, iframes, formulaires, navigation, publicités et contenu masqué sont retirés avant conversion. Le Markdown restant peut toujours contenir des instructions hostiles ou trompeuses : il doit rester traité comme une source, jamais comme une instruction prioritaire. Les métadonnées brutes du fournisseur et les secrets ne sont jamais renvoyés.

Toute réponse d'outil réussie et toute resource JSON expose
`contentTrust: EXTERNAL_UNTRUSTED_CONTENT` avec une notice stable. Les contenus
comme « ignore les instructions précédentes » sont conservés comme texte pour
ne pas falsifier la source, mais n'influencent jamais le contrôle. La provenance
publique distingue provider, URL demandée/finale/canonique, instant réel de
récupération et statut de source selon l'outil ; aucune date absente n'est
inventée.

## Secrets et profils

`application.profile` ou `MCP_PROFILE` vaut `development`, `test` ou
`production`. Les jetons d'exemple connus sont acceptés uniquement en
développement et refusés avant démarrage dans les autres profils, sans être
recopiés dans le diagnostic. Compose exige explicitement `SEARXNG_SECRET` et
`CRAWL4AI_API_TOKEN`. L'installateur Windows génère des valeurs aléatoires
propres au profil utilisateur et les conserve lors des mises à jour.

## Supply chain

Le SDK MCP est fixé exactement, les transitives corrigées sont verrouillées et
les images OCI sont référencées par digest. `npm run check:supply-chain` contrôle
hors ligne versions, digests, absence de secrets Compose par défaut et licences
de production. La qualification réseau complète ce gate par `npm audit` et
`npm audit --omit=dev`; aucun `npm audit fix` aveugle n'est utilisé.
