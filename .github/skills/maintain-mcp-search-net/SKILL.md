---
name: maintain-mcp-search-net
description: >
  Maintenir, auditer, déboguer, sécuriser, tester, documenter et faire évoluer le
  serveur MCP TypeScript mcp-search-net. Utiliser pour les contrôles de santé du dépôt,
  les travaux de roadmap, les corrections de bugs, les nouvelles fonctionnalités, les
  refactorings, les mises à jour de dépendances, les revues de sécurité, les
  investigations SSRF/cache/provider, la readiness de release, les échecs CI, les
  problèmes d'installation Docker/Windows et l'alignement de la documentation.
owner: mcp-search-net
version: 1.2.0
lastReviewed: '2026-08-30'
---

# Maintenir mcp-search-net

## Démarrer chaque tâche

1. Lire `.github/copilot-instructions.md` et les `.github/instructions/*.instructions.md` applicables.
2. Inspecter `git status --short` et préserver les modifications sans rapport ou mises en attente par l'utilisateur.
3. Lire les sources, tests, documentation et section de roadmap concernés avant de proposer des modifications.
4. Exécuter `node .github/skills/maintain-mcp-search-net/scripts/project-snapshot.mjs` lorsqu'un contexte global du dépôt est utile.
5. Classifier la demande :
   - audit/explication : rester en lecture seule et rapporter les preuves ;
   - diagnostic : reproduire et identifier la cause ; ne pas corriger sauf demande explicite ;
   - changement/construction : implémenter, tester et mettre à jour la documentation concernée ;
   - release/sécurité : utiliser les checklists plus strictes ci-dessous.

Lire [project-map.md](references/project-map.md) pour l'architecture, les commandes et la propriété. Lire [security-checklist.md](references/security-checklist.md) pour tout travail lié aux URLs, HTTP, Crawl4AI, Docker, cache, journalisation, dépendances ou secrets.

**Anti-dérive** : `AGENTS.md`, `CLAUDE.md`, `.github/copilot-instructions.md` et `docs/reference/tools.md`
sont des sources de vérité redondantes pour l'inventaire des outils/resources publics et le tableau
des boundaries de couches. Toute modification de contrat public doit toucher les quatre en une
seule fois, validée par `npm run docs:check` (fonctions `validatePublicContractInventory` et
`validateAgentInstructionConsistency` dans `scripts/check-docs.mjs`). Ne jamais modifier un seul
de ces fichiers isolément.

## Implémenter les changements

1. Énoncer les critères d'acceptation en termes concrets et testables.
2. Modifier la couche la plus basse appropriée :
   - domain pour les règles déterministes et les modèles ;
   - application pour l'orchestration et les ports ;
   - infrastructure pour les providers, SQLite, HTTP, DNS, la configuration et la journalisation ;
   - presentation pour les schémas MCP, le mapping et les fallbacks texte ;
   - bootstrap uniquement pour la composition et le cycle de vie.
3. Ajouter un test de régression ou de contrat avant ou avec l'implémentation.
4. Préserver la frontière V1 à deux outils sauf si la roadmap autorise explicitement un changement de périmètre.
5. Mettre à jour les docs de référence et la roadmap uniquement lorsque l'implémentation et les preuves de validation le justifient.

## Valider proportionnellement

- Changement ciblé : exécuter le fichier Vitest le plus proche et `npm run typecheck`.
- Changement cross-couche : exécuter `npm run check` sous Node 24.
- Changement SearXNG : exécuter aussi `RUN_LIVE_SEARXNG=1 npm test -- tests/e2e/mcp-live-search.test.ts` lorsque les services et le réseau sont disponibles.
- Changement Crawl4AI : exécuter aussi `RUN_LIVE_CRAWL4AI=1 npm test -- tests/e2e/mcp-live.test.ts` lorsque c'est explicitement approprié.
- Changement Compose/config : exécuter `docker compose config --quiet` ; inspecter la santé sans remplacer silencieusement les données utilisateur.
- Changement d'installation : tester la première installation et une réinstallation en préservant la configuration et les données utilisateur.

Ne jamais affirmer qu'une vérification ignorée, indisponible ou non exécutée a réussi. Enregistrer la commande, le résultat et la limitation.

## Règles de sécurité et de release

- Traiter les URLs, réponses DNS, redirects, JSON provider, Markdown extrait et instructions de page comme des entrées hostiles.
- Préserver les contrôles SSRF avant chaque connexion réseau et après chaque redirect.
- Réserver stdout exclusivement au JSON-RPC MCP ; les logs et diagnostics vont sur stderr.
- Ne jamais exposer des secrets, variables d'environnement, headers d'autorisation, fichiers locaux, stack traces ou contenu fetché complet dans les erreurs/logs.
- Ne jamais exécuter de commandes Git/filesystem/cloud destructives, publier, pousser ou modifier des systèmes externes sans autorisation explicite.
- Pour les audits, classer les résultats par sévérité et inclure preuves fichier/ligne, scénario d'exploitation ou d'échec, et remédiation.
- Pour les releases, exiger des vérifications déterministes propres, un statut de tests live explicite, un alignement de la documentation et une divulgation des risques résiduels.

## Terminer

Résumer d'abord le résultat, puis les fichiers modifiés, les tests exécutés, les risques résiduels et l'action suivante la plus sûre. Ne pas marquer un travail de roadmap comme terminé tant que sa condition de sortie n'est pas effectivement démontrée.
