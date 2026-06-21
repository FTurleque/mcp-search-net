# Rapport de validation — Phases 5 à 7

Date : 21 juin 2026

## Résultat

Les phases 5, 6 et 7 sont terminées. La validation déterministe sous Node.js 24.14.0 produit :

- 17 fichiers de tests réussis et 2 suites réseau optionnelles ignorées par défaut ;
- 104 tests réussis ;
- typecheck, ESLint, Prettier, compilation et validation Copilot réussis.
- les tests MCP réseau réels `search_web` et `fetch_url` ont réussi après la recette déterministe.

## Phase 5 — Cache

- espaces typés `search`, `content` et `temporary-error` ;
- migration SQLite conservatrice ajoutant ETag, Last-Modified et hash ;
- conservation contrôlée des entrées expirées et stale fallback pour les deux fournisseurs ;
- revalidation HTTP 304 et hash SHA-256 ;
- TTL V1, cache désactivable et poursuite configurable après panne ;
- tests SQLite réels couvrant migration, fraîcheur, stale, corruption, pruning, concurrence et indisponibilité.

## Phase 6 — Observabilité

Les dix événements stables sont émis en JSON sur `stderr` et corrélés par `requestId`. Les clés sensibles sont expurgées récursivement et les erreurs n'exposent pas leur stack. Un test de processus prouve que `stdout` reste exclusivement JSON-RPC.

## Phase 7 — Configuration et déploiement

- priorité valeurs internes → YAML → environnement → paramètres d'outil ;
- maxima V1 impossibles à augmenter par YAML ;
- image `mcp-search-net:1.0.0` construite avec succès ;
- Compose complet à trois services, réseau backend interne, volumes séparés et dépendances de santé ;
- override hybride limité à `127.0.0.1` ;
- appel MCP conteneurisé STDIO réussi sans TTY ;
- cycle Windows réel réussi dans un profil temporaire : installation, réinstallation conservatrice, `-KeepData`, puis désinstallation complète.

## Commandes et preuves

```powershell
npm run check
docker compose -f compose.yaml config --quiet
docker compose -f compose.yaml -f compose.hybrid.yaml config --quiet
docker compose --profile stdio build mcp-search-net
```

Le test d'installation a produit `INSTALLATION_LIFECYCLE_VALID`. Les conteneurs SearXNG et Crawl4AI ont atteint l'état `healthy`. L'initialisation JSON-RPC du service MCP conteneurisé a répondu avec le protocole `2025-11-25`. Les deux tests live ont ensuite réussi en 3,14 s.
