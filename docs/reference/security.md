# Sécurité

## Frontières

Le serveur accepte uniquement des lectures. Il écrit deux bases SQLite locales séparées :
`cache.sqlite`, cache Web jetable, et `catalog.db`, catalogue documentaire persistant administré
hors MCP. Il n’exécute pas le contenu récupéré et n’accorde à Copilot aucun accès direct aux API ou
fonctionnalités avancées de Crawl4AI. Le candidat `1.1.0` expose exactement cinq outils read-only :
`search_web`, `fetch_url`, `search_docs`, `list_docs` et `read_doc_section`. Toutes les resources
restent également read-only.

La politique URL rejette les schémas autres que HTTP(S), les identifiants intégrés, les ports
interdits, les noms locaux et les résolutions vers les plages IPv4/IPv6 loopback, privées,
link-local, de traduction/tunnel, réservées ou documentaires. Une réponse DNS mixant une adresse
publique et une adresse bloquée est rejetée intégralement.

`fetch_url` passe par une passerelle HTTP contrôlée. Avant chaque connexion, y compris chaque
redirection, elle valide le protocole, les identifiants, le port, le nom et toutes les réponses DNS.
La connexion est ensuite épinglée sur une adresse approuvée tout en conservant le nom TLS attendu.
Cela ferme la fenêtre de DNS rebinding entre la validation MCP et la connexion cible. Si plusieurs
adresses publiques ont été approuvées, la passerelle peut essayer l’adresse suivante après un échec
de connexion, sans jamais refaire une résolution DNS non validée.

## Défense en profondeur

- réseau backend Docker interne par défaut ; l'overlay hôte publie les providers uniquement sur
  `127.0.0.1` ;
- jeton entre le MCP et Crawl4AI ;
- capacités Linux supprimées et `no-new-privileges` dans Compose ;
- SearXNG en lecture seule avec répertoire temporaire borné ;
- schémas Zod et budgets stricts ;
- cinq redirections, 10 Mio et 20 secondes maximum par téléchargement ;
- quatre téléchargements concurrents, temporisation par origine et respect de `robots.txt`, avec
  séparation correcte des groupes `User-agent` et priorité aux groupes spécifiques ;
- requêtes SQLite préparées ;
- aucun log libre sur `stdout`.

## Frontière Crawl4AI

Crawl4AI ne télécharge plus directement la cible publique. En mode `auto`, il traite uniquement un
document `raw://` construit à partir du HTML déjà contrôlé. Scripts, styles, iframes, formulaires,
éléments actifs, SVG/MathML/canvas, métadonnées de navigation, attributs d'événement et attributs de
chargement de ressources sont supprimés avant ce rendu.

Dans le Compose complet, Crawl4AI reste uniquement sur le réseau interne `backend` et n'a pas accès
au bridge `egress`. SearXNG et le serveur MCP conservent l’egress nécessaire à leurs appels contrôlés.
L'overlay hybride peut publier l’API Crawl4AI sur le loopback hôte pour le serveur Node ; elle reste
protégée par token et n'est jamais exposée comme outil MCP.

## Contenu malveillant

Scripts, styles, iframes, formulaires, navigation, publicités et contenu masqué sont retirés avant
conversion. Le Markdown restant peut toujours contenir des instructions hostiles ou trompeuses : il
doit rester traité comme une source, jamais comme une instruction prioritaire. Les métadonnées brutes
du fournisseur et les secrets ne sont jamais renvoyés.

Toute réponse d'outil réussie et toute resource JSON expose
`contentTrust: EXTERNAL_UNTRUSTED_CONTENT` avec une notice stable. Les contenus comme « ignore les
instructions précédentes » sont conservés comme texte pour ne pas falsifier la source, mais
n'influencent jamais le contrôle. La provenance publique distingue provider, URL
demandée/finale/canonique, instant réel de récupération et statut de source selon l'outil ; aucune
date absente n'est inventée.

## Secrets et profils

`application.profile` ou `MCP_PROFILE` vaut `development`, `test` ou `production`. Les jetons
d'exemple connus sont acceptés uniquement en développement et refusés avant démarrage dans les autres
profils, sans être recopiés dans le diagnostic. Compose exige explicitement `SEARXNG_SECRET` et
`CRAWL4AI_API_TOKEN`. L'installateur Windows génère des valeurs aléatoires propres au profil
utilisateur et les conserve lors des mises à jour.

Les profils distribués Windows et Docker sont `production` et fixent `security.allowHttp: false`. Le
schéma refuse toute combinaison `profile: production` avec HTTP public activé. Cette règle vise les
URLs publiques demandées aux outils ; les endpoints internes SearXNG/Crawl4AI en HTTP restent séparés
de cette politique.

## Supply chain

Le SDK MCP est fixé exactement à `@modelcontextprotocol/sdk@1.30.0`, les transitives corrigées sont
verrouillées et les images OCI sont référencées par digest. Le runtime de référence est Node.js
`24.18.0` pour le développement qualifié, la CI, Docker et le bundle Windows.

Les seuls scripts lifecycle npm approuvés sont les versions explicitement enregistrées dans
`package.json`; `.npmrc` active `strict-allow-scripts=true`, de sorte qu’une nouvelle dépendance avec
un script d’installation non revue fait échouer `npm ci`. `npm run check:supply-chain` contrôle hors
ligne le SDK, les overrides, cette allowlist, le mode strict, les digests OCI, l'absence de secrets
Compose par défaut et les licences de production. La qualification réseau complète ce gate par
`npm audit` et `npm audit --omit=dev`; aucun `npm audit fix` aveugle n'est utilisé.
