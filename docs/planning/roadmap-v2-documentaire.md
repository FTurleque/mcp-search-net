# Roadmap V2 — Catalogue documentaire et recherche avancée

> **Statut** : Étude V2 démarrée — V2 BUILD GO documentaire, implémentation runtime à lancer après clôture de l'issue #5
>
> **Dernière mise à jour** : 2026-07-03

## Pré-requis obligatoires

La V2 peut être étudiée et cadrée. L'implémentation runtime V2 ne doit démarrer qu'après validation des ADR, du schéma catalogue, du benchmark et du contrat MCP V2.

### PR-01 : V1 officiellement close

- [x] Tous les critères d'acceptation AC-01 à AC-15 validés avec preuve.
- [x] Checklist finale de livraison complétée.
- [x] Recette IntelliJ/Copilot : serveur `mcp-search-net` Running et exactement deux outils visibles, `search_web` et `fetch_url`.
- [x] CI verte sur le run GitHub Actions `28391318969`.
- [x] Rapport de validation finale archivé dans `docs/planning/validation-v1-recette-finale-2026-06-27.md`.

**Condition de déblocage** : satisfaite pour l'étude V2. Toute phase d'implémentation doit continuer à exécuter la suite V1.

### PR-02 : Contrats V1 gelés

- [x] ADR-011 publié : frontière V1/V2 définie.
- [x] Outils publics V1 gelés : `search_web` et `fetch_url`.
- [x] Enveloppes de réponse, codes d'erreur et invariants de sécurité gelés.
- [x] Cache V1 confirmé opportuniste et supprimable.

**Condition de déblocage** : aucune modification incompatible des contrats publics V1 pendant V2.

### PR-03 : Décision SDK MCP au démarrage V2

- [x] ADR-012 créé : planification migration SDK v2.
- [x] ADR-013 créé : conserver `@modelcontextprotocol/sdk@1.29.0` au démarrage V2.
- [ ] Spike SDK/resources à réévaluer avant exposition MCP V2.

**Condition de déblocage** : satisfaite pour V2.0 à V2.3. À réviser avant la phase d'exposition MCP V2.

### PR-04 : Architecture V2 validée

- [x] ADR-010 publié : SQLite FTS5 et BM25 comme socle lexical.
- [x] ADR-014 publié : séparation `cache.db` / `catalog.db`.
- [x] ADR-015 publié : index FTS5 `contentless-delete`.
- [x] ADR-016 publié : exposition mixte outil + resources MCP, avec spike IntelliJ/Copilot.
- [x] Schéma catalogue V2 documenté dans `docs/reference/catalog-schema-v2.md`.
- [x] Synchronisation V2 documentée dans `docs/reference/catalog-sync-v2.md`.
- [x] Benchmark V2 documenté dans `docs/planning/benchmark-v2.md`.

**Condition de déblocage** : satisfaite pour préparer l'implémentation V2.1. Les migrations runtime ne sont pas encore créées.

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

### Composants principaux

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
│   ├── document_aliases
│   ├── sync_runs
│   ├── staleness_events
│   └── document_sections_fts
├── Synchronisation hors MCP
│   ├── CLI catalog
│   ├── worker optionnel
│   ├── ETag / Last-Modified / hash
│   └── non-suppression après un seul échec
├── Recherche avancée
│   ├── FTS5 contentless-delete
│   ├── BM25 scoring
│   ├── filtres source/document/version/langue
│   └── snippets et budgets de contexte
└── Exposition MCP
    ├── outil candidat search_docs
    └── resources catalogue/sources/documents/sections
```

### Séparation cache V1 / catalogue V2

Selon ADR-011 et ADR-014 :

- **Cache V1** : `search_cache` et `content_cache`, TTL, supprimable.
- **Catalogue V2** : `catalog.db`, tables métier, durable.
- **Aucune fusion** : le catalogue ne dépend pas du cache.
- **Migrations distinctes** : conventions `C001__...` pour le catalogue.
- **Index FTS5** : dérivé, reconstructible, jamais source de vérité.

### Exposition MCP V2

Décision de cadrage :

- outil principal candidat : `search_docs` ;
- alias encore à arbitrer : `search_catalog` ;
- resources candidates :
  - `mcp-search-net://catalog` ;
  - `mcp-search-net://sources` ;
  - `mcp-search-net://sources/{sourceId}` ;
  - `mcp-search-net://documents/{documentId}` ;
  - `mcp-search-net://documents/{documentId}/versions` ;
  - `mcp-search-net://documents/{documentId}/versions/{versionId}` ;
  - `mcp-search-net://sections/{sectionId}`.

Un spike IntelliJ/Copilot est obligatoire avant gel du contrat final resources/tools.

## Phases de développement V2

### Phase V2.0 — Étude et cadrage (P0)

**Objectif** : valider les décisions avant tout code runtime V2.

- [x] Mettre à jour la validation V1 avec CI et IntelliJ.
- [x] Créer ADR-013 SDK MCP au démarrage V2.
- [x] Créer ADR-014 séparation `cache.db` / `catalog.db`.
- [x] Créer ADR-015 FTS5 `contentless-delete`.
- [x] Créer ADR-016 tools/resources MCP V2.
- [x] Documenter le schéma catalogue V2.
- [x] Documenter la synchronisation V2.
- [x] Documenter le benchmark FTS5/BM25.
- [ ] Relire et valider l'issue #5.
- [ ] Ouvrir une PR de cadrage.

**Condition de sortie** : `V2 STUDY COMPLETE` et `V2 IMPLEMENTATION READY`.

### Phase V2.1 — Stockage catalogue et migrations (P0)

**Objectif** : créer `catalog.db`, ses migrations et ses repositories sans MCP V2 public.

- [ ] Créer `CatalogDatabase`.
- [ ] Créer `CatalogMigrationRunner`.
- [ ] Créer `catalog-migrations/C001__...`.
- [ ] Créer modèles `CatalogSource`, `Document`, `DocumentVersion`, `DocumentSection`.
- [ ] Créer port `CatalogRepository`.
- [ ] Implémenter `SqliteCatalogRepository`.
- [ ] Tester migrations sur base vide et base déjà migrée.
- [ ] Tester absence de tables V2 dans `cache.db`.
- [ ] Tester suppression de `cache.db` sans impact `catalog.db`.

**Condition de sortie** : catalogue durable initialisé, tests verts, V1 non régressée.

### Phase V2.2 — Ingestion manuelle et CLI (P0)

**Objectif** : ajouter des documents au catalogue via CLI, sans nouvel outil MCP.

- [ ] Créer `src/presentation/cli/`.
- [ ] Créer `src/bootstrap/catalog-cli.ts`.
- [ ] Implémenter `catalog init`.
- [ ] Implémenter `catalog add-source`.
- [ ] Implémenter import de documents seed.
- [ ] Réutiliser les ports internes de sécurité/extraction sans appeler l'outil MCP `fetch_url`.
- [ ] Créer `sync_runs` et rapports structurés.
- [ ] Tester SSRF, hash, version inchangée, nouvelle version.

**Condition de sortie** : documents ajoutables et versionnés via CLI.

### Phase V2.3 — Recherche lexicale FTS5 (P0)

**Objectif** : indexer les sections et rechercher localement.

- [ ] Créer `document_sections_fts`.
- [ ] Implémenter `CatalogIndexer`.
- [ ] Implémenter `SearchDocsUseCase` interne.
- [ ] Appliquer BM25 et filtres.
- [ ] Ajouter snippets et budget de contexte.
- [ ] Créer benchmark initial.
- [ ] Tester rebuild et verify.

**Condition de sortie** : recherche locale fonctionnelle via use case/CLI, sans exposition MCP publique si le contrat n'est pas gelé.

### Phase V2.4 — Exposition MCP V2 (P1)

**Objectif** : exposer la recherche documentaire à Copilot.

- [ ] Réaliser spike resources IntelliJ/Copilot.
- [ ] Choisir définitivement `search_docs` ou `search_catalog`.
- [ ] Créer schémas Zod.
- [ ] Enregistrer l'outil MCP V2.
- [ ] Exposer resources read-only si compatibles.
- [ ] Ajouter E2E tools/resources.
- [ ] Vérifier que `search_web` et `fetch_url` restent compatibles.

**Condition de sortie** : recherche catalogue visible et utilisable dans IntelliJ/Copilot.

### Phase V2.5 — Synchronisation incrémentale et obsolescence (P1)

**Objectif** : mettre à jour les documents depuis leurs sources.

- [ ] Implémenter `catalog sync`.
- [ ] Gérer ETag, Last-Modified, hash.
- [ ] Gérer redirections permanentes.
- [ ] Gérer 404/410 et staleness.
- [ ] Implémenter rate limiting.
- [ ] Implémenter reprise après interruption.
- [ ] Ajouter tests d'intégration.

**Condition de sortie** : synchronisation manuelle fiable, non destructive.

### Phase V2.6 — Automatisation contrôlée (P2)

**Objectif** : automatiser la synchronisation sans exposer de mutation au LLM.

- [ ] Worker/scheduler externe.
- [ ] Lock exclusif de synchronisation.
- [ ] Observabilité.
- [ ] Politique de rétention.
- [ ] Maintenance SQLite.

### Phase V2.7 — Recherche sémantique optionnelle (P3)

**Objectif** : évaluer uniquement si le benchmark lexical le justifie.

- [ ] Benchmark lexical insuffisant documenté.
- [ ] Prototype local sans API payante.
- [ ] Gain mesuré >= 15 % sur Recall@10 ou nDCG@10.
- [ ] Latence acceptable.

## Critères d'acceptation V2

### AC-V2-01 : Catalogue local opérationnel

- `catalog.db` existe et reste séparé de `cache.db`.
- Documents ajoutables et récupérables via repository.
- Migrations catalogue idempotentes.
- Aucune table V2 dans le cache V1.

### AC-V2-02 : Recherche FTS5 fonctionnelle

- Recherche multi-document avec BM25.
- Résultats classés par pertinence.
- Filtres source/version/langue applicables.
- Snippets utiles.
- Benchmark minimal exécuté.

### AC-V2-03 : Synchronisation manuelle validée

- CLI `catalog sync` fonctionnelle.
- Détection changements via ETag/Last-Modified/hash.
- Nouvelles versions créées sans duplication.
- Index FTS5 réindexé après mise à jour.
- Échecs réseau non destructifs.

### AC-V2-04 : Exposition MCP validée

- Outil V2 détecté dans IntelliJ/Copilot.
- Resources ou outils read-only disponibles selon décision ADR-016.
- Budgets de contexte respectés.
- Tests E2E STDIO verts.

### AC-V2-05 : Séparation V1/V2 respectée

- `search_web` et `fetch_url` inchangés.
- Enveloppes de réponse V1 inchangées.
- Cache V1 non réutilisé comme catalogue.
- Suites V1 toujours vertes.

## Ordre de réalisation recommandé

1. Clôturer l'issue #5 et merger le cadrage V2.0.
2. Implémenter V2.1 stockage catalogue.
3. Implémenter V2.2 ingestion CLI.
4. Implémenter V2.3 recherche FTS5.
5. Réaliser spike MCP resources.
6. Implémenter V2.4 exposition MCP.
7. Implémenter V2.5 synchronisation.
8. Évaluer V2.7 embeddings seulement si nécessaire.

## Risques et mitigation

### R-01 : Corruption ou confusion cache/catalogue

**Mitigation** : bases distinctes, runners distincts, tests de séparation.

### R-02 : Performance FTS5 insuffisante

**Mitigation** : benchmark, corpus borné, pondérations mesurées.

### R-03 : Synchronisation trop agressive

**Mitigation** : seeds explicites, rate limiting, profondeur zéro, CLI contrôlée.

### R-04 : Incompatibilité resources IntelliJ/Copilot

**Mitigation** : spike avant gel du contrat, outils read-only de secours si nécessaire.

### R-05 : Régression V1

**Mitigation** : `npm run check`, `npm run test:e2e:deterministic`, puis E2E live à chaque phase majeure.

### R-06 : Explosion du nombre de versions

**Mitigation** : rétention configurable, purge explicite via CLI, jamais automatique en V2 initiale.

## Définition de « V2 opérationnelle »

La V2 est considérée opérationnelle lorsque :

- les critères AC-V2-01 à AC-V2-05 sont validés avec preuves ;
- le catalogue contient au moins 10 documents de test indexés ;
- la recherche FTS5 retourne des résultats pertinents classés ;
- IntelliJ/Copilot détecte l'outil V2 ou les resources validées ;
- la synchronisation manuelle via CLI est documentée et testée ;
- aucune régression V1 n'est introduite.

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
