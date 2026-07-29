# Roadmap V2 — Catalogue documentaire et recherche avancée

> **Statut** : implémentation V2 documentaire en cours dans la PR #8.
>
> **Dernière mise à jour** : 2026-07-29 — V2.9 en cours sur `fix/v2-9-catalog-integrity`.
>
> **PR active** : #8 — `feat/v2-catalog-storage`, conservée en draft.
>
> **Roadmap opérationnelle actuelle** : issue #19, séquence #12 à #18. Les validations datées
> antérieures restent des preuves historiques attachées à leurs propres SHA.
>
> **GitHub Actions** : workflow `CI` temporairement déclenchable uniquement manuellement via `workflow_dispatch`, car le quota mensuel d'Actions minutes est épuisé.

## État synthétique

La V2 documentaire est avancée. La PR #8 contient déjà une implémentation locale couvrant stockage catalogue, ingestion, recherche, synchronisation contrôlée, purge, maintenance opérationnelle, recherche hybride optionnelle et exposition MCP read-only.

Avancement :

- V2.0 cadrage : terminé.
- V2.1 stockage catalogue : implémenté.
- V2.2 ingestion CLI : implémenté pour texte/Markdown et configuration YAML.
- V2.3 recherche lexicale : implémentée sur sections courantes.
- V2.4 exposition MCP : implémentée avec `search_docs`, resources read-only, versions documentaires et recette de spike IntelliJ/Copilot préparée.
- V2.5 synchronisation incrémentale : implémentée avec sync contrôlé, sync exhaustive, rate limiting applicatif, reprise par curseur, validateurs, staleness et redirections permanentes.
- V2.6 automatisation contrôlée : implémentée et validée localement sur la tranche maintenance contrôlée.
- V2.7 recherche hybride locale : implémentée et validée localement comme prototype optionnel sans API payante, modèle téléchargé ni service externe.

Le travail postérieur au dernier head vert est bien récupéré dans la PR #8. La validation locale couvre désormais V2.6 et V2.7, mais la CI complète reste à rejouer manuellement lorsque les minutes Actions seront de nouveau disponibles.

Le hardening post-audit suit désormais V2.9 à V2.15. V2.9 remplace les écritures fractionnées par
une primitive de révision atomique, réconcilie ADR-015 via C007, protège les migrations par checksum
et étend `catalog verify`. Aucun item ultérieur ni le merge de #8 ne peut contourner son gate.

## Pré-requis V2

### PR-01 : V1 officiellement close

- [x] Critères d'acceptation V1 validés.
- [x] Recette IntelliJ/Copilot V1 réalisée avec `search_web` et `fetch_url`.
- [x] Rapport de validation finale archivé dans `docs/planning/validation-v1-recette-finale-2026-06-27.md`.

### PR-02 : Contrats V1 gelés

- [x] ADR-011 publié : frontière V1/V2 définie.
- [x] Outils publics V1 gelés : `search_web` et `fetch_url`.
- [x] Cache V1 confirmé opportuniste et supprimable.

### PR-03 : Décisions architecture V2

- [x] ADR-010 : SQLite FTS5 et BM25.
- [x] ADR-013 : conserver le SDK MCP actuel au démarrage V2.
- [x] ADR-014 : séparation `cache.db` / `catalog.db`.
- [x] ADR-015 : FTS5 `contentless-delete`.
- [x] ADR-016 : exposition mixte outil + resources MCP.
- [x] Schéma catalogue V2 documenté.
- [x] Synchronisation V2 documentée.
- [x] Benchmark V2 documenté.

## Vision V2

La V2 transforme `mcp-search-net` en gestionnaire de catalogue documentaire local avec recherche multi-document, versioning, synchronisation contrôlée et recherche lexicale avancée.

La V2 reste local-first : SQLite, FTS, BM25, CLI/worker et MCP STDIO. Aucun LLM interne et aucune API payante ne sont requis.

## Architecture cible

- Cache V1 : `.data/cache.db`, supprimable.
- Catalogue V2 : `.data/catalog.db`, durable.
- Migrations catalogue : `catalog-migrations/Cxxx__...`.
- Tables principales : `catalog_sources`, `documents`, `document_versions`, `document_sections`, `sync_runs`, `document_section_fts`.
- Recherche : FTS/BM25 avec fallback LIKE et snippets.
- Synchronisation : CLI contrôlée, ETag, Last-Modified, hash, staleness non destructif, sync exhaustive, rate limiting et reprise par curseur.
- Maintenance contrôlée locale : cycle `catalog:maintain`, verrou inter-processus, rétention opérationnelle, analyse/optimisation SQLite, checkpoint WAL et vacuum optionnel.
- Recherche hybride locale optionnelle : reranking lexical/sémantique déterministe côté CLI, sans API payante, sans modèle téléchargé et sans service externe.
- MCP : outils V1 conservés, outil V2 `search_docs`, resources read-only.

## Exposition MCP V2

État implémenté dans la PR #8 :

- outil V2 : `search_docs` ;
- resources statiques :
  - `mcp-search-net://catalog` ;
  - `mcp-search-net://sources` ;
  - `mcp-search-net://documents` ;
  - `mcp-search-net://sections` ;
- templates read-only :
  - `mcp-search-net://sources/{sourceId}` ;
  - `mcp-search-net://documents/{documentId}` ;
  - `mcp-search-net://documents/{documentId}/versions` ;
  - `mcp-search-net://documents/{documentId}/versions/{versionId}` ;
  - `mcp-search-net://sections/{sectionId}`.

La recette de spike IntelliJ/Copilot est prête dans `docs/planning/spike-intellij-copilot-mcp-v2.md`. Son exécution manuelle reste obligatoire avant gel définitif du contrat utilisateur.

## Phases

### V2.0 — Étude et cadrage

- [x] ADR et documents de cadrage produits.
- [x] Schéma catalogue documenté.
- [x] Synchronisation documentée.
- [x] Benchmark documenté.

### V2.1 — Stockage catalogue et migrations

- [x] `catalog.db` séparé de `cache.db`.
- [x] Migrations catalogue `C001` à `C007` sans réécriture rétroactive.
- [x] Checksums SHA-256 et transition sûre du registre C001-C006.
- [x] `CatalogRepository`.
- [x] `SqliteCatalogRepository`.
- [x] Ouverture runtime et fermeture propre au shutdown.
- [x] Dockerfile corrigé pour embarquer les migrations catalogue.

### V2.2 — Ingestion manuelle et CLI

- [x] CLI `catalog init`.
- [x] CLI `catalog status`.
- [x] CLI `catalog add-source`.
- [x] CLI `catalog list-sources`.
- [x] CLI `catalog load-sources`.
- [x] CLI `catalog ingest-text`.
- [x] Ingestion texte/Markdown.
- [x] Hash contenu, version documentaire, sections et compteurs.

### V2.3 — Recherche lexicale

- [x] Recherche locale sur sections courantes.
- [x] Filtres `sourceKey`, `language`, `limit`.
- [x] Snippets.
- [x] CLI `catalog search`.
- [x] CLI `catalog rebuild-index`.
- [x] CLI `catalog verify`.
- [x] Use-case `SearchCatalogDocuments`.
- [x] Use-case `VerifyCatalog`.

### V2.4 — Exposition MCP V2

- [x] Outil MCP `search_docs`.
- [x] Wrapper MCP V2 conservant `search_web` et `fetch_url`.
- [x] Resources read-only catalogue/sources/documents/sections.
- [x] Templates read-only sources/documents/sections.
- [x] Templates read-only versions documentaires.
- [x] Lookup SQLite des versions documentaires par document et par id.
- [x] E2E MCP partiel sur resources et templates.
- [x] Recette de spike IntelliJ/Copilot V2 préparée.
- [ ] Revalidation locale ou CI manuelle du head courant de PR.
- [ ] Spike IntelliJ/Copilot sur resources MCP à exécuter.

### V2.5 — Synchronisation incrémentale

- [x] `catalog sync --dry-run`.
- [x] `catalog sync` contrôlé par `--config`, `--file`, `--source-key`, `--limit`.
- [x] Sync exhaustive quand `--limit` est absent.
- [x] Option `--rate-limit-ms` et délai applicatif entre documents.
- [x] Option `--resume-after` pour reprendre après un document déjà traité.
- [x] Sync réseau via `Crawl4aiContentFetcher`.
- [x] `CatalogSyncRun`.
- [x] Reconstruction de l'index après sync réel.
- [x] Validateurs `contentHash`, `ETag`, `Last-Modified`.
- [x] `notModified` et hash identique traités en `unchanged`.
- [x] `404` traité en `STALE` non destructif.
- [x] `410` traité en `REMOVED` non destructif.
- [x] Redirection permanente traitée en `REDIRECTED`.
- [ ] Revalidation locale ou CI manuelle du head courant de PR.

### V2.6 — Automatisation contrôlée

- [x] Worker/scheduler externe.
- [x] Lock inter-processus robuste.
- [x] Observabilité structurée par événement.
- [x] Politique de rétention opérationnelle.
- [x] Maintenance SQLite.

Validation locale V2.6 :

- `npm run lint` : OK.
- `npm run typecheck` : OK.
- `npm run build` : OK.
- `npm run test` : OK.
- 35 fichiers de tests passés.
- 180 tests passés.
- `npm run catalog:maintain -- --path .data/catalog-spike.db` : OK sur le catalogue de spike.
- Statut archivé dans [`status-v2-6.md`](status-v2-6.md).
- Validation archivée dans [`validation-v2-6-local-success-2026-07-05.md`](validation-v2-6-local-success-2026-07-05.md).

### V2.7 — Recherche hybride locale optionnelle

- [x] Prototype local sans API payante.
- [x] Vectorisation locale déterministe.
- [x] Use-case `HybridSearchCatalogDocuments`.
- [x] CLI `catalog-hybrid-search`.
- [x] Script npm `catalog:hybrid-search`.
- [x] Test applicatif du reranking hybride.
- [x] Documentation `catalog-semantic-search-v2.md`.
- [x] Validation locale typecheck/build/tests/recherche hybride.
- [ ] Benchmark comparatif lexical/hybride sur corpus représentatif.
- [ ] Décision de généralisation après mesure du gain et de la latence.

Validation locale V2.7 :

- `npm run typecheck` : OK.
- `npm run build` : OK.
- `npm run test` : OK, 36 fichiers de tests passés, 182 tests passés.
- Recherche hybride : OK sur le catalogue de spike.
- Résultats retournés : 10.
- Stratégie : `lexical-semantic-hybrid`.
- Statut archivé dans [`status-v2-7.md`](status-v2-7.md).
- Validation archivée dans [`validation-v2-7-local-success-2026-07-05.md`](validation-v2-7-local-success-2026-07-05.md).

### V2.8 à V2.15 — Hardening post-audit

- [x] V2.8 : benchmark initial de taille MCP et nettoyage qualité incrémental (#9, #10, #11).
- [ ] V2.9 : intégrité transactionnelle, FTS et migrations (#12) — implémentation et tests ciblés
  réalisés, qualification exact-head et clôture encore requises.
- [ ] V2.10 : gates qualité, coverage et gouvernance (#13, #10).
- [ ] V2.11 : scalabilité, pagination et budget contexte (#14, #9, #11).
- [ ] V2.12 : sécurité, installation et exploitation (#15).
- [ ] V2.13 : qualité de recherche et benchmark représentatif (#16).
- [ ] V2.14 : clients MCP et gel des contrats (#17).
- [ ] V2.15 : qualification finale et réconciliation documentaire exhaustive (#18).

## Critères d'acceptation V2

### AC-V2-01 : Catalogue local opérationnel

- [x] `catalog.db` existe et reste séparé de `cache.db`.
- [x] Documents ajoutables et récupérables via repository.
- [x] Migrations catalogue idempotentes.
- [x] Runtime ouvert et fermé proprement.

### AC-V2-02 : Recherche fonctionnelle

- [x] Recherche multi-document sur sections courantes.
- [x] Résultats filtrables.
- [x] Snippets disponibles.
- [x] Recherche hybride locale disponible en CLI optionnelle.
- [ ] Benchmark final à exécuter sur corpus représentatif.

### AC-V2-03 : Synchronisation manuelle validée

- [x] CLI `catalog sync` fonctionnelle en mode contrôlé.
- [x] Sync exhaustive sans `--limit`.
- [x] Rate limiting applicatif.
- [x] Reprise après interruption via `--resume-after`.
- [x] Détection changements via ETag, Last-Modified et hash.
- [x] Échecs 404/410 non destructifs.
- [ ] Validation locale ou CI manuelle sur le head courant de la PR #8.

### AC-V2-04 : Exposition MCP validée

- [x] `search_docs` implémenté.
- [x] Resources read-only implémentées côté serveur.
- [x] Templates dynamiques sources, documents, versions et sections implémentés côté serveur.
- [x] E2E MCP partiel ajouté.
- [x] Recette de spike IntelliJ/Copilot préparée.
- [ ] Validation locale ou CI manuelle sur le head courant de la PR #8.
- [ ] Spike IntelliJ/Copilot à exécuter.

### AC-V2-05 : Séparation V1/V2 respectée

- [x] `search_web` et `fetch_url` conservés.
- [x] Cache V1 non réutilisé comme catalogue.
- [x] Catalogue séparé dans `catalog.db`.
- [x] Suites V1/V2 revalidées localement sur le head courant de la PR #8.

### AC-V2-06 : Exploitation contrôlée V2.6 validée

- [x] Cycle `catalog:maintain` disponible hors MCP.
- [x] Verrou inter-processus robuste.
- [x] Observabilité structurée par événement.
- [x] Rétention opérationnelle des runs de synchronisation.
- [x] Maintenance SQLite locale documentée et testée.
- [x] Validation locale sur `.data/catalog-spike.db`.

### AC-V2-07 : Recherche hybride optionnelle V2.7 validée

- [x] Prototype local sans dépendance payante.
- [x] CLI `catalog-hybrid-search` disponible.
- [x] Scores lexical, sémantique local et hybride retournés.
- [x] Validation locale sur catalogue de spike.
- [ ] Benchmark final lexical/hybride restant à faire avant généralisation.

## Ordre de réalisation recommandé

1. Terminer et qualifier #12.
2. Exécuter dans l'ordre #13, #14, #15, #16, #17 puis #18.
3. Conserver #8 en draft et ne pas déclencher GitHub Actions pendant la restriction de quota.
4. Qualifier exact-head localement, Docker/Linux et clients selon #18.
5. Merger #8 sous garde expected-head uniquement après tous les gates, puis revalider `master`.

## Validation locale recommandée

```bash
npm run format:check
npm run lint
npm run build
npm run test:unit
npm run test:integration
npm run test:e2e:deterministic
```

Validation Docker/live à faire localement ou après reset du quota :

```bash
docker compose build mcp-search-net
docker compose up -d --wait searxng crawl4ai
npm run test:e2e
docker compose down
```

## Risques et mitigation

- **Corruption cache/catalogue** : bases distinctes, runners distincts, tests de séparation.
- **Performance recherche insuffisante** : benchmark, corpus borné, pondérations mesurées.
- **Synchronisation trop agressive** : seeds explicites, rate limiting, profondeur zéro, CLI contrôlée.
- **Incompatibilité resources IntelliJ/Copilot** : spike avant gel du contrat, outil `search_docs` comme fallback read-only si nécessaire.
- **Régression V1** : validation locale puis CI manuelle dès reset du quota Actions.
- **Explosion du nombre de versions** : rétention configurable et purge explicite.
- **Consommation GitHub Actions** : workflow `CI` manuel uniquement tant que le quota est épuisé.

## Définition de V2 opérationnelle

La V2 sera considérée opérationnelle lorsque :

- les critères AC-V2-01 à AC-V2-07 seront validés avec preuves sur un head courant ;
- le catalogue contiendra au moins 10 documents de test indexés ;
- la recherche retournera des résultats pertinents classés ;
- IntelliJ/Copilot détectera et exploitera `search_docs` ou les resources validées ;
- la synchronisation manuelle via CLI sera documentée et testée ;
- la maintenance contrôlée sera documentée et testée ;
- la recherche hybride restera optionnelle tant que le benchmark final ne justifie pas sa généralisation ;
- aucune régression V1 ne sera introduite.

## Références

- [ADR-010 — Préparer la V2 avec SQLite FTS5](../adr/ADR-010-v2-sqlite-fts5.md)
- [ADR-011 — Figer la frontière V1/V2](../adr/ADR-011-v1-v2-boundary.md)
- [ADR-012 — Planifier la migration SDK MCP v2](../adr/ADR-012-migration-sdk-mcp-v2.md)
- [ADR-013 — Conserver le SDK MCP V1 au démarrage V2](../adr/ADR-013-sdk-mcp-v2-start-decision.md)
- [ADR-014 — Isoler le catalogue V2 dans catalog.db](../adr/ADR-014-catalog-db-isolation.md)
- [ADR-015 — Utiliser FTS5 contentless-delete](../adr/ADR-015-fts5-contentless-delete.md)
- [ADR-016 — Exposer la V2 avec outil et resources MCP](../adr/ADR-016-mcp-v2-tools-resources.md)
- [Schéma catalogue V2](../reference/catalog-schema-v2.md)
- [Synchronisation catalogue V2](../reference/catalog-sync-v2.md)
- [Exploitation catalogue V2.6](../reference/catalog-operations-v2.md)
- [Recherche sémantique V2.7](../reference/catalog-semantic-search-v2.md)
- [Spike IntelliJ/Copilot — MCP V2 documentaire](spike-intellij-copilot-mcp-v2.md)
- [Benchmark V2](benchmark-v2.md)
- [Statut V2.6](status-v2-6.md)
- [Validation locale V2.6](validation-v2-6-local-success-2026-07-05.md)
- [Statut V2.7](status-v2-7.md)
- [Validation locale V2.7](validation-v2-7-local-success-2026-07-05.md)
