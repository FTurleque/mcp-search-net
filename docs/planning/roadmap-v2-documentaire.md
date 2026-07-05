# Roadmap V2 — Catalogue documentaire et recherche avancée

> **Statut** : Implémentation V2 documentaire en cours dans la PR #8.
>
> **Dernière mise à jour** : 2026-07-05.
>
> **PR active** : #8 — `feat/v2-catalog-storage`, conservée en draft.
>
> **Head courant** : `e237b6f3152a8ffb7ec37eb675b517d2bf38d9a3`.
>
> **Dernier head validé CI complète** : `4bfb191da05768759b6a9d8531aa3fd5762612c1`, run 462.
>
> **Budget GitHub Actions** : quota mensuel épuisé. Le workflow `CI` est temporairement déclenchable uniquement manuellement via `workflow_dispatch`.

## Synthèse d'avancement

La V2 n'est plus seulement en cadrage. Une première V2 documentaire opérationnelle est en construction dans la PR #8.

État actuel :

- V2.0 cadrage : terminé.
- V2.1 stockage catalogue : implémenté.
- V2.2 ingestion CLI : implémenté pour texte/Markdown et configuration YAML.
- V2.3 recherche lexicale : implémentée sur sections courantes avec SQLite/FTS et fallback LIKE.
- V2.4 exposition MCP : implémentée partiellement avec `search_docs` et resources read-only, y compris versions documentaires.
- V2.5 synchronisation incrémentale : implémentée partiellement, avec sync contrôlé, validateurs, staleness et redirections permanentes.
- V2.6 automatisation contrôlée : non démarrée.
- V2.7 embeddings : non démarrée, à conserver optionnelle.

Le travail postérieur au dernier head vert est récupéré dans la PR #8, mais attend une revalidation complète dès que les minutes GitHub Actions seront disponibles ou via validation locale.

## Pré-requis obligatoires

### PR-01 : V1 officiellement close

- [x] Tous les critères d'acceptation AC-01 à AC-15 validés avec preuve.
- [x] Checklist finale de livraison complétée.
- [x] Recette IntelliJ/Copilot : serveur `mcp-search-net` Running et exactement deux outils visibles, `search_web` et `fetch_url`.
- [x] CI verte sur le run GitHub Actions `28391318969`.
- [x] Rapport de validation finale archivé dans `docs/planning/validation-v1-recette-finale-2026-06-27.md`.

**Condition de déblocage** : satisfaite. Les contrats V1 doivent rester compatibles pendant V2.

### PR-02 : Contrats V1 gelés

- [x] ADR-011 publié : frontière V1/V2 définie.
- [x] Outils publics V1 gelés : `search_web` et `fetch_url`.
- [x] Enveloppes de réponse, codes d'erreur et invariants de sécurité gelés.
- [x] Cache V1 confirmé opportuniste et supprimable.

**Condition de déblocage** : aucune modification incompatible des contrats publics V1 pendant V2.

### PR-03 : Décision SDK MCP au démarrage V2

- [x] ADR-012 créé : planification migration SDK v2.
- [x] ADR-013 créé : conserver `@modelcontextprotocol/sdk@1.29.0` au démarrage V2.
- [x] Exposition MCP V2 initiale implémentée avec le SDK actuel.
- [ ] Spike final IntelliJ/Copilot à exécuter sur les resources MCP V2.

**Condition de déblocage** : satisfaite pour implémenter V2. Les limites d'ergonomie IntelliJ/Copilot restent à mesurer.

### PR-04 : Architecture V2 validée

- [x] ADR-010 publié : SQLite FTS5 et BM25 comme socle lexical.
- [x] ADR-014 publié : séparation `cache.db` / `catalog.db`.
- [x] ADR-015 publié : index FTS5 `contentless-delete`.
- [x] ADR-016 publié : exposition mixte outil + resources MCP, avec spike IntelliJ/Copilot.
- [x] Schéma catalogue V2 documenté dans `docs/reference/catalog-schema-v2.md`.
- [x] Synchronisation V2 documentée dans `docs/reference/catalog-sync-v2.md`.
- [x] Benchmark V2 documenté dans `docs/planning/benchmark-v2.md`.

**Condition de déblocage** : satisfaite. L'implémentation runtime est en cours dans la PR #8.

## Vision V2

La V2 transforme `mcp-search-net` en un **gestionnaire de catalogue documentaire local** avec recherche multi-document, versioning, synchronisation contrôlée et recherche lexicale avancée.

La V2 reste local-first : SQLite, FTS5, BM25, CLI/worker et MCP STDIO. Aucun LLM interne et aucune API payante ne sont requis.

### Objectifs métier

- **Catalogue local** : indexer une bibliothèque de documentation technique officielle.
- **Recherche multi-document** : retrouver des informations dans plusieurs documents simultanément.
- **Versioning** : conserver les versions documentaires importantes.
- **Synchronisation contrôlée** : mettre à jour les sources explicitement via CLI ou worker.
- **Recherche avancée** : FTS5/BM25 d'abord, embeddings optionnels seulement après benchmark.

### Non-objectifs V2 initiale

- Crawl autonome de domaines entiers.
- Authentification Web ou accès à des ressources privées.
- LLM interne ou génération de contenu.
- Modification ou annotation de documents upstream.
- Interface graphique utilisateur.
- Exposition de `sync`, `purge` ou `rebuild-index` comme outils MCP librement appelables.
- Embeddings sans benchmark.

## Architecture V2

```text
Catalogue V2
├── Stockage SQLite séparé
│   ├── .data/cache.db      (cache V1 supprimable)
│   └── .data/catalog.db    (catalogue V2 durable)
├── Tables catalogue
│   ├── catalog_sources
│   ├── documents
│   ├── document_versions
│   ├── document_sections
│   ├── sync_runs
│   └── document_section_fts
├── Synchronisation hors MCP
│   ├── CLI catalog
│   ├── configuration catalog-sources.yml
│   ├── ETag / Last-Modified / hash
│   └── non-suppression après un seul échec
├── Recherche avancée
│   ├── FTS5 / BM25
│   ├── fallback LIKE
│   ├── filtres source/langue/limite
│   └── snippets
└── Exposition MCP
    ├── outils V1 conservés : search_web / fetch_url
    ├── outil V2 : search_docs
    └── resources catalogue/sources/documents/versions/sections
```

### Séparation cache V1 / catalogue V2

Selon ADR-011 et ADR-014 :

- **Cache V1** : `search_cache` et `content_cache`, TTL, supprimable.
- **Catalogue V2** : `catalog.db`, tables métier, durable.
- **Aucune fusion** : le catalogue ne dépend pas du cache.
- **Migrations distinctes** : conventions `C001__...` pour le catalogue.
- **Index FTS** : dérivé, reconstructible, jamais source de vérité.

### Exposition MCP V2

État implémenté dans la PR #8 :

- outil V2 : `search_docs` ;
- resources statiques read-only :
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

Un spike IntelliJ/Copilot reste obligatoire avant gel définitif du contrat utilisateur.

## Phases de développement V2

### Phase V2.0 — Étude et cadrage (P0)

**Objectif** : valider les décisions avant le code runtime V2.

- [x] Mettre à jour la validation V1 avec CI et IntelliJ.
- [x] Créer ADR-013 SDK MCP au démarrage V2.
- [x] Créer ADR-014 séparation `cache.db` / `catalog.db`.
- [x] Créer ADR-015 FTS5 `contentless-delete`.
- [x] Créer ADR-016 tools/resources MCP V2.
- [x] Documenter le schéma catalogue V2.
- [x] Documenter la synchronisation V2.
- [x] Documenter le benchmark FTS5/BM25.

**Condition de sortie** : satisfaite pour lancer l'implémentation.

### Phase V2.1 — Stockage catalogue et migrations (P0)

**Objectif** : créer `catalog.db`, ses migrations et ses repositories.

- [x] Créer `CatalogDatabase`.
- [x] Créer `CatalogMigrationRunner`.
- [x] Créer les migrations catalogue `C001` à `C005`.
- [x] Créer modèles `CatalogSource`, `CatalogDocument`, `DocumentVersion`, `DocumentSection`.
- [x] Créer port `CatalogRepository`.
- [x] Implémenter `SqliteCatalogRepository`.
- [x] Ouvrir le catalogue au runtime.
- [x] Fermer proprement le catalogue au shutdown.
- [x] Corriger le packaging Docker pour embarquer les migrations catalogue.
- [x] Tester migrations et repository SQLite sur le dernier head vert.

**Condition de sortie** : satisfaite sur le head vert `4bfb191d...`.

### Phase V2.2 — Ingestion manuelle et CLI (P0)

**Objectif** : ajouter des documents au catalogue via CLI, sans mutation MCP.

- [x] Créer CLI catalogue minimale.
- [x] Implémenter `catalog init`.
- [x] Implémenter `catalog status`.
- [x] Implémenter `catalog add-source`.
- [x] Implémenter `catalog list-sources`.
- [x] Implémenter `catalog load-sources` depuis YAML.
- [x] Implémenter `catalog ingest-text`.
- [x] Lire fichiers locaux texte/Markdown.
- [x] Calculer hash contenu SHA-256.
- [x] Upsert document et version.
- [x] Découper Markdown en sections.
- [x] Stocker `contentHash`, `characterCount`, `tokenCount`.

**Condition de sortie** : satisfaite pour l'ingestion texte/Markdown.

### Phase V2.3 — Recherche lexicale FTS (P0)

**Objectif** : indexer les sections et rechercher localement.

- [x] Ajouter l'index de recherche documentaire.
- [x] Implémenter `rebuildSearchIndex`.
- [x] Implémenter `searchDocuments` côté repository.
- [x] Implémenter `SearchCatalogDocuments`.
- [x] Ajouter CLI `catalog search`.
- [x] Ajouter filtres `sourceKey`, `language`, `limit`.
- [x] Ajouter snippets.
- [x] Ajouter fallback LIKE quand FTS ne retourne rien.
- [x] Ajouter `catalog verify` et use-case `VerifyCatalog`.

**Condition de sortie** : recherche locale fonctionnelle via repository/use-case/CLI sur le dernier head vert.

### Phase V2.4 — Exposition MCP V2 (P1)

**Objectif** : exposer la recherche documentaire et les resources read-only à Copilot.

- [x] Choisir `search_docs` pour l'outil V2 initial.
- [x] Enregistrer l'outil MCP `search_docs`.
- [x] Conserver `search_web` et `fetch_url`.
- [x] Exposer resources statiques catalogue/sources/documents/sections.
- [x] Exposer templates sources/documents/sections.
- [x] Récupérer les templates versions documentaires dans la PR #8.
- [x] Ajouter le listing versions documentaires par document.
- [x] Ajouter la lecture d'une version documentaire par id.
- [x] Ajouter E2E resources MCP pour `listResources` et `listResourceTemplates`.
- [x] Ajouter E2E partiel pour le listing versions.
- [ ] Revalider localement ou via CI manuelle le head courant `e237b6f...`.
- [ ] Réaliser spike final resources IntelliJ/Copilot.
- [ ] Documenter l'ergonomie réelle dans IntelliJ/Copilot.

**Condition de sortie** : implémentation récupérée, validation complète en attente de budget Actions ou validation locale.

### Phase V2.5 — Synchronisation incrémentale et obsolescence (P1)

**Objectif** : mettre à jour les documents depuis leurs sources de manière contrôlée.

- [x] Implémenter `catalog sync --dry-run`.
- [x] Implémenter `catalog sync` contrôlé par `--config`, `--file`, `--source-key`, `--limit`.
- [x] Utiliser `Crawl4aiContentFetcher` pour le sync réseau contrôlé.
- [x] Enregistrer `CatalogSyncRun`.
- [x] Reconstruire l'index FTS après sync réel.
- [x] Transmettre `contentHash`, `ETag`, `Last-Modified` au fetcher.
- [x] Court-circuiter en `unchanged` sur `notModified`.
- [x] Court-circuiter en `unchanged` quand le hash est identique.
- [x] Gérer `404` en `STALE` sans supprimer la version courante.
- [x] Gérer `410` en `REMOVED` sans supprimer la version courante.
- [x] Gérer les redirections permanentes en `REDIRECTED` avec conservation du `stableKey`.
- [ ] Implémenter synchronisation exhaustive multi-sources/multi-documents sans garde-fou excessif.
- [ ] Implémenter rate limiting applicatif.
- [ ] Implémenter reprise après interruption.

**Condition de sortie** : sync manuelle partiellement livrée, robustesse exhaustive à terminer.

### Phase V2.6 — Automatisation contrôlée (P2)

**Objectif** : automatiser la synchronisation sans exposer de mutation au LLM.

- [ ] Worker/scheduler externe.
- [ ] Lock exclusif de synchronisation.
- [ ] Observabilité des runs.
- [ ] Politique de rétention opérationnelle.
- [ ] Maintenance SQLite.

### Phase V2.7 — Recherche sémantique optionnelle (P3)

**Objectif** : évaluer uniquement si le benchmark lexical le justifie.

- [ ] Benchmark lexical insuffisant documenté.
- [ ] Prototype local sans API payante.
- [ ] Gain mesuré >= 15 % sur Recall@10 ou nDCG@10.
- [ ] Latence acceptable.

## Critères d'acceptation V2

### AC-V2-01 : Catalogue local opérationnel

- [x] `catalog.db` existe et reste séparé de `cache.db`.
- [x] Documents ajoutables et récupérables via repository.
- [x] Migrations catalogue idempotentes.
- [x] Le runtime ouvre et ferme le catalogue proprement.

### AC-V2-02 : Recherche FTS fonctionnelle

- [x] Recherche multi-document sur sections courantes.
- [x] Résultats classés et filtrables.
- [x] Filtres source/langue/limit applicables.
- [x] Snippets utiles.
- [ ] Benchmark final à exécuter sur corpus documentaire représentatif.

### AC-V2-03 : Synchronisation manuelle validée

- [x] CLI `catalog sync` fonctionnelle en mode contrôlé.
- [x] Détection changements via ETag/Last-Modified/hash.
- [x] Nouvelles versions créées sans duplication.
- [x] Index réindexé après mise à jour.
- [x] Échecs réseau non destructifs pour 404/410.
- [ ] Sync exhaustive, rate limiting et reprise à finaliser.

### AC-V2-04 : Exposition MCP validée

- [x] Outil V2 `search_docs` implémenté.
- [x] Resources read-only implémentées côté serveur.
- [x] Templates dynamiques sources/documents/versions/sections implémentés côté serveur.
- [x] Tests E2E MCP partiels ajoutés.
- [ ] Validation locale ou CI manuelle sur le head courant.
- [ ] Spike IntelliJ/Copilot à exécuter.

### AC-V2-05 : Séparation V1/V2 respectée

- [x] `search_web` et `fetch_url` conservés.
- [x] Cache V1 non réutilisé comme catalogue.
- [x] Catalogue séparé dans `catalog.db`.
- [ ] Suites V1 à revalider sur le head courant quand le budget Actions sera disponible ou localement.

## Ordre de réalisation recommandé à partir du 2026-07-05

1. Ne pas consommer GitHub Actions tant que le quota mensuel est épuisé.
2. Continuer les changements avec validation locale uniquement.
3. Revalider localement le head courant `e237b6f...`.
4. Après reset du quota, lancer manuellement le workflow `CI` via `workflow_dispatch`.
5. Finaliser sync exhaustive multi-sources/multi-documents.
6. Ajouter rate limiting et reprise après interruption.
7. Exécuter le spike IntelliJ/Copilot sur resources MCP.
8. Évaluer les embeddings seulement si le benchmark lexical le justifie.

## Validation locale recommandée en attendant GitHub Actions

```bash
npm run format:check
npm run lint
npm run build
npm run test:unit
npm run test:integration
npm run test:e2e:deterministic
```

Pour la validation Docker/live après reset du quota ou sur poste local :

```bash
docker compose build mcp-search-net
docker compose up -d --wait searxng crawl4ai
npm run test:e2e
docker compose down
```

## Risques et mitigation

### R-01 : Corruption ou confusion cache/catalogue

**Mitigation** : bases distinctes, runners distincts, tests de séparation.

### R-02 : Performance FTS insuffisante

**Mitigation** : benchmark, corpus borné, pondérations mesurées.

### R-03 : Synchronisation trop agressive

**Mitigation** : seeds explicites, rate limiting, profondeur zéro, CLI contrôlée, limite temporaire par `--limit`.

### R-04 : Incompatibilité resources IntelliJ/Copilot

**Mitigation** : spike avant gel du contrat, outils read-only de secours si nécessaire.

### R-05 : Régression V1

**Mitigation** : validation locale, puis CI manuelle dès reset du quota Actions.

### R-06 : Explosion du nombre de versions

**Mitigation** : rétention configurable, purge explicite via CLI, jamais automatique en V2 initiale.

### R-07 : Consommation GitHub Actions

**Mitigation** : workflow `CI` déclenché uniquement manuellement via `workflow_dispatch` jusqu'au reset du quota.

## Définition de V2 opérationnelle

La V2 sera considérée opérationnelle lorsque :

- les critères AC-V2-01 à AC-V2-05 seront validés avec preuves sur un head courant ;
- le catalogue contiendra au moins 10 documents de test indexés ;
- la recherche retourne des résultats pertinents classés ;
- IntelliJ/Copilot détectera et exploitera `search_docs` ou les resources validées ;
- la synchronisation manuelle via CLI sera documentée et testée ;
- sync exhaustive, rate limiting et reprise seront stabilisés ;
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
- [Benchmark V2](benchmark-v2.md)
