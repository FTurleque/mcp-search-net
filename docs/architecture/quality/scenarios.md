# Scénarios qualité détaillés

> mcp-search-net v1.1.0 · 2026-08-08

Ce fichier complète la [section 10 — Exigences qualité](../arc42/10-exigences-qualite.md) avec des scénarios supplémentaires et les scénarios de changement.

---

## Scénarios d'usage

### QU-01 — Recherche dans le catalogue hors ligne

**Contexte** : Docker arrêté, pas d'accès Internet.
**Stimulus** : Agent LLM appelle `search_docs {query: "API authentication"}`.
**Réponse** : Résultats depuis FTS5 local dans `catalog.db` sans aucune connexion réseau.
**Mesure** : Réponse retournée en < 150 ms p95.
**Vérification** : `tests/e2e/mcp-stdio.test.ts` (deterministic, sans Docker).

### QU-02 — Fallback langue anglaise

**Contexte** : `search_web` appelé avec `language: "fr"`, SearXNG retourne 0 résultats.
**Stimulus** : Aucun résultat en français.
**Réponse** : Nouvelle recherche en anglais, réponse avec warning `FALLBACK_LANGUAGE_USED`.
**Mesure** : Warning présent dans `response.warnings`.
**Vérification** : `tests/application/search-web.test.ts`.

### QU-03 — Cache hit sur contenu documentaire

**Contexte** : `fetch_url` appelé deux fois sur la même URL dans la fenêtre TTL.
**Stimulus** : Deuxième appel identique.
**Réponse** : Réponse depuis cache, `cacheStatus=HIT`, aucun appel réseau.
**Mesure** : Latence < 5 ms (cache SQLite in-process).
**Vérification** : `tests/application/fetch-url.test.ts`.

---

## Scénarios de changement

### QC-01 — Remplacement de SearXNG par un autre moteur

**Contexte** : SearXNG remplacé par un autre méta-moteur (Whoogle, Brave Search local…).
**Stimulus** : Nouveau provider implémente `SearchProvider`.
**Impact attendu** : Uniquement `src/infrastructure/search/` + injection dans `container.ts`.
**Mesure** : Zéro modification dans `src/domain/` ou `src/application/`.
**Risque** : Aucun si le port `SearchProvider` est respecté.

### QC-02 — Ajout d'un sixième outil MCP

**Contexte** : Nouvel outil `fetch_sitemap` ajouté.
**Stimulus** : Enregistrement dans `mcp-server-v2.ts`.
**Impact attendu** : Nouveau use case dans `application/`, nouveau schéma Zod, mise à jour des tests E2E et de contrat.
**Risque** : Rupture de `schemaVersion` si les annotations ou le contrat existant sont modifiés.

### QC-03 — Migration vers Node.js 26 LTS

**Contexte** : Node.js 24 entre en maintenance.
**Stimulus** : Mise à jour de `engines.node` dans `package.json`.
**Impact attendu** : `runtime-guard.ts`, `tsconfig`, CI, Dockerfile, installateur Windows, distribution ZIP.
**Risque** : Rebuild requis de `better-sqlite3` si les prebuilds N-API ne couvrent pas Node 26.

### QC-04 — Intégration d'embeddings locaux (prototype)

**Contexte** : Prototype vectoriel autorisé par ADR-018 décidé intégrable.
**Stimulus** : Nouvel ADR d'intégration, nouveau port `VectorIndex`.
**Impact attendu** : Nouvelle couche infrastructure, rebuild de l'index, packaging Windows/Docker, redistribution du modèle.
**Risque** : Mémoire, offline, licence du modèle, budget CI.

---

## Scénarios de défaillance

### QD-01 — `catalog.db` corrompu

**Contexte** : Coupure électrique pendant une transaction d'écriture.
**Stimulus** : Démarrage du serveur avec `catalog.db` corrompu.
**Réponse attendue** : Démarrage échoue avec `ConfigurationError` sur `stderr` ; log explicite.
**Mitigation** : après ouverture et migrations, `PRAGMA integrity_check`,
`PRAGMA foreign_key_check` et les invariants current/sections/FTS sont vérifiés avant exposition du
serveur MCP ; restauration depuis backup (`catalog backup`).
**Note** : À la différence du cache, `catalog.db` n'a pas de mode `continueOnError` — c'est intentionnel (ADR-014).

### QD-02 — Crawl4AI retourne du contenu malveillant

**Contexte** : Document HTML contenant des instructions d'injection de prompt.
**Stimulus** : Contenu retourné par Crawl4AI vers `fetch_url`.
**Réponse attendue** : Contenu marqué `EXTERNAL_UNTRUSTED_CONTENT` ; jamais exécuté comme instruction.
**Mesure** : Zéro exécution du contenu ; retourné tel quel au LLM client.
**Vérification** : Revue de code ; `tool-call.ts` ne parse pas le Markdown retourné.

### QD-03 — Dépassement de la limite de redirections

**Contexte** : URL avec chaîne de 6 redirections (limite = 5).
**Stimulus** : `fetch_url` sur cette URL.
**Réponse attendue** : `TooManyRedirectsError` → code `TOO_MANY_REDIRECTS` dans la réponse MCP.
**Mesure** : Moins de 5 octets téléchargés depuis la 6e destination.
**Vérification** : `tests/infrastructure/secure-http-gateway.test.ts`.
