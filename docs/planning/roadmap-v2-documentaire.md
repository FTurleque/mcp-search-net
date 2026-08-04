# Roadmap V2 — Catalogue documentaire et recherche avancée

> **Statut courant** : candidat `1.1.0` en qualification finale, non publié. Le verdict et les gates
> du checkout sont centralisés dans [`docs/status/current-state.md`](../status/current-state.md).
>
> **Dernière preuve historique** : 2026-07-29 — V2.13 qualifiée exact-head, mergée dans
> `feat/v2-catalog-storage` via PR #24 et réconciliée post-merge ; prochain jalon : V2.14 / #17.
>
> **Contexte de planification historique** : la PR #8, la branche `feat/v2-catalog-storage`,
> l'issue #19 et la séquence #12 à #18 décrivent le pilotage de cette roadmap à l'époque. Ils ne
> constituent pas le statut GitHub courant. Les validations datées restent attachées à leurs
> propres SHA.
>
> **GitHub Actions** : le blocage de facturation observé le 4 juillet 2026 est historique. Son état
> actuel n'est pas observable avec les permissions disponibles ; aucun run ne valide les têtes
> actuelles. Le candidat rétablit les triggers PR, sans transformer l'absence de run en PASS.

## État synthétique

Le candidat présent couvre le stockage catalogue, l'ingestion, la recherche, la synchronisation
contrôlée, la purge, la maintenance opérationnelle, le reranking lexical optionnel et l'exposition
MCP read-only. Cette phrase décrit le checkout ; les références aux anciennes PR ci-dessous restent
des jalons historiques.

Avancement :

- V2.0 cadrage : terminé.
- V2.1 stockage catalogue : implémenté.
- V2.2 ingestion CLI : implémenté pour texte/Markdown et configuration YAML.
- V2.3 recherche lexicale : implémentée sur sections courantes.
- V2.4 exposition MCP : implémentée avec exactement cinq outils — les deux outils V1 et
  `search_docs`, `list_docs`, `read_doc_section` — plus resources read-only, versions documentaires
  et recette de spike IntelliJ/Copilot préparée.
- V2.5 synchronisation incrémentale : implémentée avec cycle persistant `RUNNING` vers un statut
  terminal, sync contrôlée/exhaustive, rate limiting, reprise, validateurs, touch sur `304`, aliases,
  événements de staleness et redirections permanentes.
- V2.11 scalabilité : lectures par identifiant, filtres SQL, pagination stable, resources bornées et
  benchmark jusqu'à 10 000 sections qualifiés localement sans skip.
- V2.6 automatisation contrôlée : implémentée et validée localement sur la tranche maintenance contrôlée.
- V2.7 reranking lexical historique : prototype local optionnel, initialement nommé « hybrid/semantic » alors qu'il n'utilise aucun embedding.
- V2.12 sécurité/exploitation : corrections post-audit qualifiées sous Windows sur le head exact
  `4651ccae3315e4b64e1bd42e1274fa9eed34a83f`, SonarQube Cloud vert avec 0 Security Hotspots,
  puis merge tree-equivalent `64622e6e40f3ad18bc5c2a867a5600f19bf2d25c` dans la branche d'agrégation.
- V2.13 qualité de recherche : nomenclature corrigée, benchmark 10 sources / 100 documents / 10 000
  sections / 50 requêtes, qualification exacte sur `aeb49b1f6a7f035779e726a9db641710f172819f`,
  merge #24 tree-equivalent `c9ba09345cebb1a9f9dfa63f98e0352c33dcefd2`. FTS5/BM25 reste la baseline,
  le reranker lexical hashé n'est pas généralisé et une étude séparée d'embeddings locaux est justifiée.

Les validations historiques restent attachées à leurs SHA respectifs. Les preuves V2.12 et V2.13
archivent chacune la qualification exact-head et la vérification que leur merge n'a introduit aucun
changement de contenu.

Le hardening post-audit suit V2.9 à V2.15. V2.9 remplace les écritures fractionnées par une primitive
de révision atomique, réconcilie ADR-015 via C007, protège les migrations par checksum et étend
`catalog verify`. Les tranches V2.9 à V2.13 sont maintenant intégrées et qualifiées. Aucun item
ultérieur ni le merge de #8 ne peut contourner son gate.

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
- [x] ADR-014 : séparation `cache.sqlite` / `catalog.db`.
- [x] ADR-015 : FTS5 `contentless-delete`.
- [x] ADR-016 : exposition mixte outil + resources MCP.
- [x] ADR-017 : stratégie de recherche décidée sur benchmark V2.13.
- [x] Schéma catalogue V2 documenté.
- [x] Synchronisation V2 documentée.
- [x] Benchmark V2 documenté et exécuté.

## Vision V2

La V2 transforme `mcp-search-net` en gestionnaire de catalogue documentaire local avec recherche multi-document, versioning, synchronisation contrôlée et recherche lexicale avancée.

La V2 reste local-first : SQLite, FTS, BM25, CLI/worker et MCP STDIO. Aucun LLM interne et aucune API payante ne sont requis.

## Architecture cible

- Cache V1 : `.data/cache.sqlite`, supprimable.
- Catalogue V2 : `.data/catalog.db`, durable.
- Migrations catalogue : `C001` à `C008` sous `catalog-migrations/`, immuables après application.
- Tables principales : `catalog_sources`, `documents`, `document_versions`, `document_sections`,
  `document_aliases`, `sync_runs`, `staleness_events`, `document_section_fts`.
- Recherche : FTS5/BM25 avec fallback LIKE et snippets ; baseline produit actuelle confirmée par V2.13.
- Synchronisation : CLI contrôlée, ETag, Last-Modified, hash des octets HTTP en V2, lifecycle de
  run, observations et staleness non destructif, sync exhaustive, rate limiting et reprise par
  curseur. Un éventuel hash du contenu normalisé est reporté à V3.
- Maintenance contrôlée locale : cycle `catalog:maintain`, verrou inter-processus, rétention opérationnelle, analyse/optimisation SQLite, checkpoint WAL et vacuum optionnel.
- Reranking lexical hashé : expérimental et non généralisé après gain qualité V2.13 mesuré à zéro.
- Embeddings locaux : étude autorisée uniquement dans une tranche distincte avec benchmark comparatif ; aucune API commerciale obligatoire.
- MCP : outils V1 conservés, outils V2 `search_docs`, `list_docs` et `read_doc_section`, resources
  read-only.

## Exposition MCP V2

État implémenté dans le candidat `1.1.0` de la PR #8 :

- cinq outils read-only : `search_web`, `fetch_url`, `search_docs`, `list_docs`,
  `read_doc_section` ;
- resources statiques :
  - `mcp-search-net://catalog` ;
  - `mcp-search-net://sources` ;
  - `mcp-search-net://documents` ;
  - `mcp-search-net://sections` ;
- templates read-only :
  - `mcp-search-net://sources/page/{offset}` ;
  - `mcp-search-net://sources/{sourceId}` ;
  - `mcp-search-net://documents/page/{offset}` ;
  - `mcp-search-net://documents/{documentId}` ;
  - `mcp-search-net://documents/{documentId}/versions` ;
  - `mcp-search-net://documents/{documentId}/versions/page/{offset}` ;
  - `mcp-search-net://documents/{documentId}/versions/{versionId}` ;
  - `mcp-search-net://sections/page/{offset}` ;
  - `mcp-search-net://sections/{sectionId}`.

La recette de spike IntelliJ/Copilot est prête dans `docs/planning/spike-intellij-copilot-mcp-v2.md`. Son exécution manuelle reste obligatoire avant gel définitif du contrat utilisateur.

## Phases

### V2.0 — Étude et cadrage

- [x] ADR et documents de cadrage produits.
- [x] Schéma catalogue documenté.
- [x] Synchronisation documentée.
- [x] Benchmark documenté.

### V2.1 — Stockage catalogue et migrations

- [x] `catalog.db` séparé de `cache.sqlite`.
- [x] Migrations catalogue `C001` à `C008` sans réécriture rétroactive.
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
- [x] Outils MCP compacts `list_docs` et `read_doc_section`.
- [x] Wrapper MCP V2 conservant `search_web` et `fetch_url`.
- [x] Resources read-only catalogue/sources/documents/sections.
- [x] Templates read-only sources/documents/sections.
- [x] Templates read-only versions documentaires.
- [x] Lookup SQLite des versions documentaires par document et par id.
- [x] E2E MCP partiel sur resources et templates.
- [x] Recette de spike IntelliJ/Copilot V2 préparée.
- [ ] Revalidation locale ou CI manuelle du head courant de PR #8.
- [ ] Spike IntelliJ/Copilot sur resources MCP à exécuter.

### V2.5 — Synchronisation incrémentale

- [x] `catalog sync --dry-run`.
- [x] `catalog sync` contrôlé par `--config`, `--file`, `--source-key`, `--limit`.
- [x] Sync exhaustive quand `--limit` est absent.
- [x] Option `--rate-limit-ms` et délai applicatif entre documents.
- [x] Option `--resume-after` pour reprendre après un document déjà traité.
- [x] Sync réseau via `Crawl4aiContentFetcher`.
- [x] `CatalogSyncRun` créé en `RUNNING`, puis clôturé une fois en `SUCCESS`, `PARTIAL` ou
      `FAILED` ; `CANCELLED` reste un état de schéma non émis par les use cases actuels.
- [x] Reconstruction de l'index après sync réel.
- [x] Validateurs `contentHash`, `ETag`, `Last-Modified`.
- [x] `notModified` traité en `unchanged` avec mise à jour de `last_seen_at`, sans nouvelle version ;
      hash identique traité en `unchanged`.
- [x] Aliases `OLD_URL`, `REDIRECT`, `CANONICAL` et événements réellement observés persistés avec
      leur `sync_run`.
- [x] Hash V2 défini sur le payload HTTP brut ; hash du contenu normalisé reporté à V3.
- [x] `404` traité en `STALE` non destructif.
- [x] `410` traité en `REMOVED` non destructif.
- [x] Redirection permanente traitée en `REDIRECTED`.
- [ ] Revalidation locale ou CI manuelle du head courant de PR #8.

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

### V2.7 — Prototype de reranking lexical local

État historique V2.7 :

- [x] Prototype local sans API payante.
- [x] Vectorisation locale déterministe par feature hashing.
- [x] Prototype initialement exposé sous les noms `HybridSearchCatalogDocuments`, `catalog-hybrid-search` et `lexical-semantic-hybrid`.
- [x] Validation locale historique typecheck/build/tests/reranking.

Réconciliation V2.13 :

- [x] Nomenclature corrigée : `HashedLexicalVectorizer`, `RerankedSearchCatalogDocuments`, `rerankScore`, `combinedScore`, `fts5-hashed-lexical-rerank`.
- [x] Anciens symboles `semantic`/`hybrid` trompeurs retirés du build courant.
- [x] Benchmark comparatif exécuté sur 10 000 sections et 50 requêtes annotées.
- [x] Gain qualité du reranker mesuré à 0 : aucune généralisation.
- [x] Étude séparée d'embeddings locaux autorisée par ADR-017, sans intégration automatique.

Validation locale historique V2.7 :

- `npm run typecheck` : OK.
- `npm run build` : OK.
- `npm run test` : OK, 36 fichiers de tests passés, 182 tests passés.
- Recherche hybride historique : OK sur le catalogue de spike.
- Résultats retournés : 10.
- Ancienne stratégie : `lexical-semantic-hybrid`.
- Statut archivé dans [`status-v2-7.md`](status-v2-7.md).
- Validation archivée dans [`validation-v2-7-local-success-2026-07-05.md`](validation-v2-7-local-success-2026-07-05.md).

### V2.8 à V2.15 — Hardening post-audit

- [x] V2.8 : benchmark initial de taille MCP et nettoyage qualité incrémental (#9, #10, #11).
- [x] V2.9 : intégrité transactionnelle, FTS et migrations (#12) — intégrée dans la branche
      d'agrégation, qualifiée sur le head exact et clôturée.
- [x] V2.10 : gates qualité, coverage et gouvernance (#13, #10) — runtime et tests V2
      réintégrés dans ESLint/Prettier, couverture globale et ciblée mesurée, workflow alors manuel
      dédupliqué, rapports publiables et gates locaux historiques qualifiés sans skip.
- [x] V2.11 : scalabilité, pagination et budget contexte (#14, #9, #11) — implémentation,
      benchmark et qualification locale terminés sans skip.
- [x] V2.12 : sécurité, installation et exploitation (#15) — corrections post-audit qualifiées sur
      head exact Windows/déterministe, runtime et rollback validés, audits npm à zéro, SonarQube
      Cloud vert, merge #23 tree-equivalent intégré dans `feat/v2-catalog-storage`.
- [x] V2.13 : qualité de recherche et benchmark représentatif (#16) — qualification exact-head
      `aeb49b1f6a7f035779e726a9db641710f172819f`, merge #24 tree-equivalent, FTS5/BM25 conservé
      comme baseline, reranker lexical non généralisé, étude d'embeddings locaux autorisée.
- [ ] V2.14 : clients MCP et gel des contrats (#17).
- [ ] V2.15 : qualification finale et réconciliation documentaire exhaustive (#18).

## Critères d'acceptation V2

### AC-V2-01 : Catalogue local opérationnel

- [x] `catalog.db` existe et reste séparé de `cache.sqlite`.
- [x] Documents ajoutables et récupérables via repository.
- [x] Migrations catalogue idempotentes.
- [x] Runtime ouvert et fermé propre au shutdown.

### AC-V2-02 : Recherche fonctionnelle

- [x] Recherche multi-document sur sections courantes.
- [x] Résultats filtrables.
- [x] Snippets disponibles.
- [x] Reranking lexical local disponible comme expérience mesurée.
- [x] Benchmark représentatif exécuté : 10 sources, 100 documents, 10 000 sections, 50 requêtes.
- [x] Décision V2.13 documentée dans ADR-017.

### AC-V2-03 : Synchronisation manuelle validée

- [x] CLI `catalog sync` fonctionnelle en mode contrôlé.
- [x] Sync exhaustive sans `--limit`.
- [x] Rate limiting applicatif.
- [x] Reprise après interruption via `--resume-after`.
- [x] Détection changements via ETag, Last-Modified et hash.
- [x] Échecs 404/410 non destructifs.
- [x] Runs persistés de `RUNNING` vers un statut terminal et observations `304`/aliases/événements
      couvertes.
- [ ] Validation locale ou CI manuelle sur le head courant de la PR #8.

### AC-V2-04 : Exposition MCP validée

- [x] `search_docs` implémenté.
- [x] `list_docs` et `read_doc_section` implémentés avec réponses compactes.
- [x] Resources read-only implémentées côté serveur.
- [x] Templates dynamiques sources, documents, versions et sections implémentés côté serveur.
- [x] Collections MCP paginées par 20, lectures par identifiant ciblées et réponses bornées à
      24 000 caractères.
- [x] Benchmark de budget contexte exécuté jusqu'à 10 000 sections : réduction de 99,67 % face à
      la simulation globale non bornée.
- [x] E2E MCP partiel ajouté.
- [x] Recette de spike IntelliJ/Copilot préparée.
- [ ] Validation locale ou CI manuelle sur le head courant de la PR #8.
- [ ] Spike IntelliJ/Copilot à exécuter.

### AC-V2-05 : Séparation V1/V2 respectée

- [x] `search_web` et `fetch_url` conservés.
- [x] Cache V1 non réutilisé comme catalogue.
- [x] Catalogue séparé dans `catalog.db`.
- [x] Suites V1/V2 revalidées localement sur le head exact V2.13.
- [x] Merge V2.13 vérifié tree-equivalent au head qualifié.
- [ ] Revalidation exact-head après intégration des tranches V2.14 à V2.15.

### AC-V2-06 : Exploitation contrôlée V2.6 validée

- [x] Cycle `catalog:maintain` disponible hors MCP.
- [x] Verrou inter-processus robuste.
- [x] Observabilité structurée par événement.
- [x] Rétention opérationnelle des runs de synchronisation.
- [x] Maintenance SQLite locale documentée et testée.
- [x] Validation locale sur `.data/catalog-spike.db`.

### AC-V2-07 : Reranking lexical V2.7/V2.13 validé

- [x] Prototype historique local sans dépendance payante.
- [x] Nomenclature corrigée pour refléter le feature hashing lexical réel.
- [x] Benchmark lexical/reranker exécuté sur corpus représentatif reproductible.
- [x] Reranker non généralisé après gain qualité mesuré à zéro.
- [x] FTS5/BM25 conservé comme baseline actuelle.
- [x] Étude d'embeddings locaux autorisée uniquement comme tranche distincte.

### AC-V2-08 : Sécurité et exploitation V2.12 validées

- [x] Réponses et resources marquées `EXTERNAL_UNTRUSTED_CONTENT`.
- [x] Provenance publique explicite et dates réelles uniquement.
- [x] Archive Node vérifiée par SHA-256 avant extraction et signature OpenJS vérifiée avant
      exécution du runtime.
- [x] Secrets locaux générés, profils non développement durcis et logs expurgés.
- [x] Lease PID/hostname/token/heartbeat validé avec tests multi-processus.
- [x] Santé bornée, backup WAL cohérent et confiné, checkpoint concurrent et restauration couverts.
- [x] Supply chain durcie : licences, versions/digests et chemins de manifests contrôlés.
- [x] Quality Gate SonarQube Cloud vert avec 0 Security Hotspots sur la PR #23.
- [x] Gates locaux exact-head PASS : 216 required, 95 unit, 6 contract, 68 security, 25 resilience,
      2 performance, 35 integration et 2 E2E déterministes, tous sans skip dans les suites contrôlées.
- [x] Runtime Windows `NODE_RUNTIME_INTEGRITY_VALID`.
- [x] Installation/upgrade/rollback/désinstallation `INSTALLATION_LIFECYCLE_VALID`.
- [x] Audits npm complet et production : 0 vulnérabilité.
- [x] Preuve finale archivée dans
      [`validation-v2-12-security-operations-2026-07-29.md`](validation-v2-12-security-operations-2026-07-29.md).

### AC-V2-09 : Qualité de recherche V2.13 validée

- [x] Benchmark exact-head exécuté sur 10 000 sections et 50 requêtes annotées.
- [x] `npm run check` complet PASS sur `aeb49b1f6a7f035779e726a9db641710f172819f`.
- [x] 221 required, 100 unit, 6 contract, 68 security, 25 resilience, 2 performance, 35 integration
      et 2 E2E déterministes PASS sans skip.
- [x] Audits npm complet et production : 0 vulnérabilité.
- [x] Merge #24 sous garde exact-head vérifié tree-equivalent.
- [x] Preuve finale archivée dans
      [`validation-v2-13-search-quality-2026-07-29.md`](validation-v2-13-search-quality-2026-07-29.md).

## Ordre de réalisation recommandé

1. V2.9 à V2.13 (#12 à #16) sont intégrées et qualifiées localement.
2. Exécuter maintenant #17 / V2.14 puis #18 / V2.15.
3. Conserver #8 en draft et déclencher la CI du candidat seulement quand son SHA est stabilisé.
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

Validation Docker/live à exécuter sur le SHA final du candidat :

```bash
docker compose build mcp-search-net
docker compose up -d --wait searxng crawl4ai
npm run test:e2e
docker compose down
```

## Risques et mitigation

- **Corruption cache/catalogue** : bases distinctes, runners distincts, tests de séparation.
- **Qualité de rappel insuffisante** : FTS5/BM25 reste la baseline ; étude d'embeddings locaux autorisée uniquement sur benchmark dédié.
- **Synchronisation trop agressive** : seeds explicites, rate limiting, profondeur zéro, CLI contrôlée.
- **Incompatibilité resources IntelliJ/Copilot** : spike avant gel du contrat, outil `search_docs` comme fallback read-only si nécessaire.
- **Régression V1** : validation locale et CI attachées au même SHA final.
- **Explosion du nombre de versions** : rétention configurable et purge explicite.
- **Preuve GitHub Actions** : conserver les validations locales exact-head et exiger un run GitHub
  attaché au candidat avant merge final ; aucune preuve datée ne vaut pour un autre SHA.

## Définition de V2 opérationnelle

La V2 sera considérée opérationnelle lorsque :

- les critères AC-V2-01 à AC-V2-09 seront validés avec preuves sur un head courant ;
- le catalogue contiendra au moins 10 documents de test indexés ;
- la recherche retournera des résultats pertinents classés ;
- IntelliJ/Copilot détectera et exploitera `search_docs` ou les resources validées ;
- la synchronisation manuelle via CLI sera documentée et testée ;
- la maintenance contrôlée sera documentée et testée ;
- le reranker lexical hashé ne sera pas généralisé sans nouveau gain mesuré ;
- toute alternative par embeddings restera locale et devra gagner un benchmark comparatif dédié ;
- aucune régression V1 ne sera introduite.

## Références

- [ADR-010 — Préparer la V2 avec SQLite FTS5](../adr/ADR-010-v2-sqlite-fts5.md)
- [ADR-011 — Figer la frontière V1/V2](../adr/ADR-011-v1-v2-boundary.md)
- [ADR-012 — Planifier la migration SDK MCP v2](../adr/ADR-012-migration-sdk-mcp-v2.md)
- [ADR-013 — Conserver le SDK MCP V1 au démarrage V2](../adr/ADR-013-sdk-mcp-v2-start-decision.md)
- [ADR-014 — Isoler le catalogue V2 dans catalog.db](../adr/ADR-014-catalog-db-isolation.md)
- [ADR-015 — Utiliser FTS5 contentless-delete](../adr/ADR-015-fts5-contentless-delete.md)
- [ADR-016 — Exposer la V2 avec outil et resources MCP](../adr/ADR-016-mcp-v2-tools-resources.md)
- [ADR-017 — Choisir la stratégie de recherche V2](../adr/ADR-017-search-quality-strategy-v2.md)
- [Schéma catalogue V2](../reference/catalog-schema-v2.md)
- [Synchronisation catalogue V2](../reference/catalog-sync-v2.md)
- [Exploitation catalogue V2.12](../reference/catalog-operations-v2.md)
- [Recherche documentaire V2.13 — FTS5 et reranking lexical](../reference/catalog-semantic-search-v2.md)
- [Spike IntelliJ/Copilot — MCP V2 documentaire](spike-intellij-copilot-mcp-v2.md)
- [Benchmark V2](benchmark-v2.md)
- [Validation V2.13](validation-v2-13-search-quality-2026-07-29.md)
- [Statut V2.6](status-v2-6.md)
- [Validation locale V2.6](validation-v2-6-local-success-2026-07-05.md)
- [Statut V2.7](status-v2-7.md)
- [Validation locale V2.7](validation-v2-7-local-success-2026-07-05.md)
