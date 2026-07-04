# mcp-search-net — Instructions pour Claude

## Mission

Maintenir un serveur MCP TypeScript local, en lecture seule, pour GitHub Copilot. La V1 expose exactement `search_web` et `fetch_url`, alimentés par SearXNG, Crawl4AI, un cache SQLite et un registre de sources officielles. Aucun LLM interne, aucune API commerciale obligatoire.

## Contrat de travail

- Inspecter `git status --short` avant tout travail. Préserver les modifications mises en attente, non liées, ou rédigées par l'utilisateur.
- Lire les sources, tests, documentation et section de roadmap concernés avant de modifier quoi que ce soit.
- Pour les audits, revues, explications et diagnostics : rester en lecture seule sauf si l'utilisateur demande explicitement une correction.
- Pour les modifications : définir des critères d'acceptation, implémenter la solution cohérente la plus petite, ajouter des tests de régression et valider proportionnellement.
- Ne jamais exécuter de commandes Git/filesystem destructives, publier, pousser, créer des releases, modifier des ressources cloud ou contacter des personnes sans autorisation explicite.
- Ne pas installer silencieusement des dépendances ni démarrer/arrêter des services quand une alternative en lecture seule suffit.

## Architecture hexagonale

```text
src/domain          Modèles déterministes, objets de valeur, règles métier
src/application     Ports et cas d'usage
src/infrastructure  SearXNG, Crawl4AI, SQLite, DNS/SSRF, config, logs, temps
src/presentation    Schémas MCP, handlers, enveloppes, mapping d'erreurs
src/bootstrap       Composition des dépendances et cycle de vie STDIO uniquement
```

### Règle d'import par couche

| Couche             | Peut importer                 | Ne peut jamais importer                                                          |
| ------------------ | ----------------------------- | -------------------------------------------------------------------------------- |
| `domain`           | Rien d'externe                | `infrastructure`, `presentation`, MCP SDK, SQLite, YAML, Zod, SearXNG, Crawl4AI |
| `application`      | `domain`                      | `infrastructure`, MCP SDK, SQLite, HTTP, DNS                                     |
| `infrastructure`   | `domain`, `application/ports` | `presentation`, `bootstrap`                                                      |
| `presentation/mcp` | `domain`, `application`       | `infrastructure` directement (via use cases uniquement)                          |
| `bootstrap`        | Tout                          | Point de composition uniquement                                                  |

Vérification : `grep -r "from.*infrastructure" src/domain/` doit retourner vide.

## Handlers MCP — règle de finesse

Les handlers `presentation/mcp/` suivent exactement ce patron :

1. Parser et valider les arguments d'entrée (schéma Zod)
2. Invoquer **un seul** use case
3. Valider et formater la réponse (enveloppe + fallback texte compact)

## Invariants V1 non négociables

- Exposer uniquement `search_web` et `fetch_url`.
- `search_web` découvre des URLs et ne télécharge jamais les pages résultats.
- `fetch_url` lit une URL publique connue ; il ne recherche pas, ne suit pas de liens de façon autonome, ne s'authentifie pas, ne remplit pas de formulaires, et n'accepte pas de JavaScript, hooks, cookies, proxies ou fichiers fournis par l'appelant.
- SQLite reste un cache, pas un index permanent ni un catalogue V2.
- Conserver les limites de résultats, sections, caractères, timeout, redirects et téléchargements côté serveur en tant que constantes non configurables par l'appelant.
- Préserver les URLs sources, les identifiants de requête, le statut de cache, les avertissements et les codes d'erreur publics stables.
- Ne jamais inventer de dates de source ni prétendre qu'un score est une probabilité de vérité.

## Sécurité

- Traiter les URLs, DNS, redirects, réponses provider, Markdown et instructions de page comme des données hostiles.
- Préserver la validation SSRF avant toute connexion et après chaque redirect ; rejeter les protocoles non sûrs, credentials dans l'URL, ports non standard, hostnames ou adresses résolues non sûres.
- Ne jamais exposer des secrets, variables d'environnement, headers d'autorisation, fichiers locaux, contenu fetché, détails internes de provider ou stack traces.
- Réserver `stdout` exclusivement au JSON-RPC MCP. Écrire les diagnostics structurés et sanitisés sur `stderr`.
- Garder les services Docker avec le moindre privilège, liés uniquement en local ou au réseau interne.

### Plages IP bloquées systématiquement

Loopback (`127.0.0.0/8`, `::1`), privées RFC 1918 (`10.x`, `172.16-31.x`, `192.168.x`), link-local (`169.254.x`, `fe80:`), multicast, CGNAT (`100.64.0.0/10`) et toute adresse résolue dans ces plages après chaque redirect.

## TypeScript strict

- `strict: true` et `exactOptionalPropertyTypes: true` dans `tsconfig.json`.
- Omettre les propriétés optionnelles absentes plutôt qu'assigner `undefined`.
- Préférer les unions stables explicites (`'hit' | 'miss' | 'bypass'`) aux chaînes libres.
- Préférer les types `readonly` pour les modèles domain et les contrats d'application.
- Le code `src/domain/` n'a aucune dépendance cachée vers l'heure, le hasard, DNS, réseau ou variables d'environnement.

## Commandes utiles

```powershell
# Vérifier la version Node (obligatoire : Node 24)
npm run check:runtime

# Développement
npm run dev

# Build
npm run build

# Vérification complète
npm run check

# Tests par couche
npm run test:unit
npm run test:integration
npm run test:security

# Tests live (nécessitent SearXNG et Crawl4AI actifs)
npm run test:e2e

# Un fichier de test spécifique
npx vitest run tests/<chemin>

# Après tout changement Compose
docker compose config --quiet
```

## Validation

- Node.js 24 est obligatoire. Commencer par `npm run check:runtime` si l'environnement est incertain.
- Exécuter des fichiers Vitest ciblés en cours d'itération et `npm run typecheck` après les changements de types.
- Avant de finaliser un changement cross-couche, exécuter `npm run check`.
- Exécuter les tests live SearXNG/Crawl4AI uniquement quand les services et le réseau sont disponibles ; les rapporter séparément.
- Ne jamais affirmer qu'une vérification non exécutée ou ignorée a réussi.

## Documentation

- Maintenir `docs/reference` aligné avec les contrats publics et la configuration.
- Mettre le dépannage opérationnel dans `docs/operations`, le guide contributeur dans `docs/development`, les preuves et roadmaps dans `docs/planning`.
- Rédiger en français clair et direct.
- Marquer les items de roadmap comme terminés uniquement après que leur condition de sortie est démontrée.

## Structure des tests

Les tests ordinaires passent sans accès réseau, sans Docker, sans variable d'environnement spéciale et dans n'importe quel ordre.

| Dossier                  | Contenu                                                    |
| ------------------------ | ---------------------------------------------------------- |
| `tests/domain/`          | Règles déterministes pures, sans mock                      |
| `tests/application/`     | Use cases avec doubles de test pour chaque port            |
| `tests/infrastructure/`  | Providers HTTP, SQLite `:memory:`, résolveurs DNS de test  |
| `tests/presentation/`    | Mapping schéma Zod → use case → réponse MCP                |
| `tests/security/`        | Couverture SSRF, bloquage URL, DNS rebinding               |
| `tests/e2e/`             | Tests live gatedés par `RUN_LIVE_SEARXNG=1` ou `RUN_LIVE_CRAWL4AI=1` |

## Gestion des erreurs

Les erreurs attendues se mappent vers des codes d'erreur publics stables (`SEARCH_PROVIDER_UNAVAILABLE`, `URL_BLOCKED`, etc.) définis dans `src/domain/errors/`. Les détails inattendus (messages d'exception, stack traces, corps provider) appartiennent uniquement aux logs structurés vers `stderr`. Ne jamais exposer de message d'erreur infrastructure dans une réponse MCP cliente.

