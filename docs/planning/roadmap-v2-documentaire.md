# Roadmap V2 — Catalogue documentaire et recherche avancée

> **Statut** : Non démarré — bloqué jusqu'à clôture officielle de la V1
>
> **Dernière mise à jour** : 27 juin 2026

## Pré-requis obligatoires

La V2 ne peut démarrer que si les conditions suivantes sont satisfaites :

### PR-01 : V1 officiellement close

- [x] Tous les critères d'acceptation AC-01 à AC-15 validés avec preuve
- [x] Checklist finale de livraison complétée
- [x] Recette IntelliJ Copilot réussie
- [ ] CI verte sur le commit de validation V1
- [ ] Rapport de validation finale archivé dans `docs/planning/`

**Condition de déblocage** : CI verte + commit de validation V1 mergé sur `main` ou tagué.

### PR-02 : Contrats V1 gelés

- [x] ADR-011 publié : frontière V1/V2 définie
- [x] Outils publics gelés : `search_web` et `fetch_url` uniquement
- [x] Enveloppes de réponse gelées : `ToolExecution<T>`, codes d'erreur stables
- [x] Invariants de sécurité documentés et testés

**Condition de déblocage** : aucune modification des contrats publics V1 pendant le développement V2.

### PR-03 : Évaluation migration SDK MCP v2

- [x] ADR-012 créé : planification migration SDK v2
- [ ] Releases officielles SDK consultées (au démarrage V2)
- [ ] Migration guide officiel lu (si v2 stable)
- [ ] Décision migration documentée (rester v1 ou migrer v2)

**Condition de déblocage** : décision documentée dans un ADR dédié (potentiel ADR-013) avant phase V2.1.

### PR-04 : Architecture V2 validée

- [x] ADR-010 publié : SQLite FTS5 et BM25 comme socle lexical
- [ ] Schéma de base de données catalogue conçu (tables, index, migrations)
- [ ] Séparation cache V1 / catalogue V2 validée
- [ ] Aucune réutilisation des tables `search_cache` ou `content_cache` pour l'index V2

**Condition de déblocage** : schéma de BDD catalogue approuvé et migrations V2 prêtes.

## Vision V2

La V2 transforme mcp-search-net en un **gestionnaire de catalogue documentaire local** avec recherche avancée multi-document, synchronisation, versioning, et recherche sémantique optionnelle.

### Objectifs métier

- **Catalogue local** : indexer et gérer une bibliothèque de documentation technique
- **Recherche multi-document** : retrouver des informations dans plusieurs documents simultanément
- **Synchronisation** : mettre à jour automatiquement les documents depuis leurs sources officielles
- **Versioning** : suivre les versions de documentation (ex: Node.js 24 vs 26)
- **Recherche avancée** : lexicale (FTS5/BM25), sémantique (embeddings optionnels)

### Non-objectifs V2

- Crawl autonome de domaines entiers (hors périmètre)
- Authentification Web ou accès à des ressources privées
- LLM interne ou génération de contenu
- Modification ou annotation de documents
- Interface graphique utilisateur (reste CLI + MCP uniquement)

## Architecture V2

### Composants principaux

```text
Catalogue V2
├── Tables SQLite (séparées du cache V1)
│   ├── documents            (métadonnées, URL source, statut)
│   ├── document_versions    (versions, date publication, hash)
│   ├── document_sections    (chapitres, headings, contenu)
│   ├── sources              (registre étendu des sources officielles)
│   └── fts_index            (index FTS5 pour recherche lexicale)
├── Synchronisation
│   ├── CLI de synchronisation (worker dédié, pas MCP)
│   ├── Stratégies de mise à jour (polling, webhook, manuel)
│   └── Détection de changements (ETag, Last-Modified, hash de contenu)
├── Recherche avancée
│   ├── FTS5 avec BM25 scoring
│   ├── Filtres (source, version, date, type)
│   └── Embeddings optionnels (si benchmark valide le gain)
└── Outils MCP V2 (nouveaux, pas de modification V1)
    ├── search_catalog       (recherche multi-document)
    ├── list_sources         (liste des sources indexées)
    └── get_document_version (récupère une version spécifique)
```

### Séparation cache V1 / catalogue V2

Selon ADR-011 :

- **Cache V1** : `search_cache` et `content_cache` restent inchangés et servent uniquement les outils V1
- **Catalogue V2** : nouvelles tables `documents`, `document_versions`, `document_sections`, `sources`, `fts_index`
- **Aucune fusion** : les deux systèmes coexistent indépendamment
- **Migrations** : série V2xx distincte de la série V1 (V001-V004)

### Outils MCP V2

**Nouveaux outils** (ajoutés aux deux outils V1 gelés) :

- `search_catalog` : recherche lexicale/sémantique dans le catalogue local
- `list_sources` : liste les sources officielles indexées avec leur statut de synchronisation
- `get_document_version` : récupère une version spécifique d'un document (ex: Node.js 24.17.0 vs 24.14.0)

**Outils V1 inchangés** :

- `search_web` : continue de découvrir des URLs sur le Web public
- `fetch_url` : continue de récupérer une URL connue sans indexation

## Phases de développement V2

### Phase V2.0 — Pré-requis techniques (P0)

**Objectif** : valider les pré-requis avant développement V2.

- [ ] Vérifier état SDK MCP : rester v1.29.0 ou migrer v2 stable
- [ ] Concevoir schéma de base de données catalogue (tables, index, migrations)
- [ ] Implémenter migrations SQLite V2 (V005-V00x)
- [ ] Créer port `CatalogRepository` avec contrat complet
- [ ] Documenter décision migration SDK dans ADR-013 (si applicable)

**Condition de sortie** : schéma catalogue validé, migrations testées, port défini.

### Phase V2.1 — Catalogue de base (P0)

**Objectif** : stocker et récupérer des documents dans le catalogue local.

- [ ] Implémenter `SqliteCatalogRepository` avec tables V2
- [ ] Créer modèles domain `Document`, `DocumentVersion`, `DocumentSection`
- [ ] Implémenter use case `AddDocument` (indexation manuelle)
- [ ] Implémenter use case `GetDocument` (récupération par ID)
- [ ] Implémenter use case `ListDocuments` (liste avec filtres)
- [ ] Tests unitaires et d'intégration

**Condition de sortie** : documents ajoutables et récupérables via repository, tests verts.

### Phase V2.2 — Recherche lexicale FTS5 (P0)

**Objectif** : recherche plein texte avec SQLite FTS5 et scoring BM25.

- [ ] Créer table `fts_index` avec FTS5 et tokenizer `unicode61`
- [ ] Implémenter indexation automatique des sections lors de l'ajout de document
- [ ] Implémenter use case `SearchCatalog` avec requêtes FTS5
- [ ] Appliquer scoring BM25 et ranking des résultats
- [ ] Créer outil MCP `search_catalog` (schéma Zod, handler, tests)
- [ ] Tests unitaires, d'intégration et E2E

**Condition de sortie** : recherche FTS5 fonctionnelle, outil MCP `search_catalog` disponible dans Copilot.

### Phase V2.3 — Synchronisation manuelle (P1)

**Objectif** : mettre à jour manuellement les documents depuis leurs sources.

- [ ] Créer CLI `scripts/sync-catalog.mjs` (worker dédié, pas MCP)
- [ ] Implémenter use case `SyncDocument` (fetch + détection changement)
- [ ] Utiliser `FetchUrl` V1 pour récupérer le contenu
- [ ] Détecter changements via ETag, Last-Modified, hash de contenu
- [ ] Créer/mettre à jour `DocumentVersion` si changement détecté
- [ ] Réindexer FTS5 après mise à jour
- [ ] Tests d'intégration avec SearXNG et Crawl4AI

**Condition de sortie** : CLI de synchronisation fonctionnelle, documents mis à jour sans duplication.

### Phase V2.4 — Versioning et sources étendues (P1)

**Objectif** : gérer plusieurs versions d'un même document et étendre le registre de sources.

- [ ] Implémenter logique de versioning (ex: Node.js 24 vs 26)
- [ ] Créer use case `GetDocumentVersion` (récupère version spécifique)
- [ ] Étendre registre `official-sources.yml` avec metadata de versioning
- [ ] Créer outil MCP `get_document_version` (schéma, handler, tests)
- [ ] Créer outil MCP `list_sources` (liste sources + statut sync)
- [ ] Tests unitaires et E2E

**Condition de sortie** : versioning fonctionnel, trois nouveaux outils MCP disponibles.

### Phase V2.5 — Synchronisation automatique (P2)

**Objectif** : automatiser la mise à jour périodique du catalogue.

- [ ] Implémenter stratégie de polling (ex: daily, weekly)
- [ ] Créer scheduler (cron-like ou worker background)
- [ ] Implémenter détection de changements upstream
- [ ] Ajouter notifications de mise à jour (logs structurés)
- [ ] Créer configuration `sync` dans `application.yml`
- [ ] Tests d'intégration avec délais simulés

**Condition de sortie** : synchronisation automatique fonctionnelle, configurable.

### Phase V2.6 — Embeddings et recherche sémantique (P3, optionnel)

**Objectif** : ajouter recherche sémantique si un benchmark démontre un gain significatif.

**Pré-requis** :
- [ ] Benchmark FTS5 vs embeddings sur corpus test (précision, recall, latence)
- [ ] Gain démontré > 15% en précision ou recall
- [ ] Latence acceptable (< 500ms pour recherche)

**Tâches** :
- [ ] Choisir modèle embeddings (local, pas d'API payante)
- [ ] Créer table `embeddings` avec vecteurs
- [ ] Implémenter génération embeddings lors de l'indexation
- [ ] Implémenter recherche sémantique (similarité cosinus)
- [ ] Intégrer dans use case `SearchCatalog` (mode `lexical` | `semantic` | `hybrid`)
- [ ] Tests et benchmark comparatif

**Condition de sortie** : recherche sémantique fonctionnelle, benchmark validant le gain.

## Critères d'acceptation V2

### AC-V2-01 : Catalogue local opérationnel

- Documents ajoutables et récupérables via repository
- Tables V2 séparées des tables V1
- Migrations SQLite V2 exécutables sans corruption

### AC-V2-02 : Recherche FTS5 fonctionnelle

- Outil MCP `search_catalog` détecté dans Copilot
- Recherche multi-document avec scoring BM25
- Résultats classés par pertinence
- Filtres (source, version, date) applicables

### AC-V2-03 : Synchronisation manuelle validée

- CLI `scripts/sync-catalog.mjs` fonctionnelle
- Détection changements via ETag/Last-Modified/hash
- Nouvelles versions créées sans duplication
- Index FTS5 réindexé après mise à jour

### AC-V2-04 : Versioning opérationnel

- Plusieurs versions d'un document stockables
- Outil MCP `get_document_version` fonctionnel
- Outil MCP `list_sources` listant statut sync

### AC-V2-05 : Séparation V1/V2 respectée

- Aucune modification des outils V1 `search_web` et `fetch_url`
- Enveloppes de réponse V1 inchangées
- Cache V1 (`search_cache`, `content_cache`) non réutilisé pour catalogue V2
- Tests E2E V1 toujours verts après développement V2

## Ordre de réalisation recommandé

1. **Valider pré-requis** : V1 close, SDK évalué, schéma approuvé
2. **Phase V2.0** : pré-requis techniques
3. **Phase V2.1** : catalogue de base
4. **Phase V2.2** : recherche lexicale FTS5
5. **Phase V2.3** : synchronisation manuelle
6. **Phase V2.4** : versioning et outils MCP étendus
7. **Phase V2.5** : synchronisation automatique (si besoin validé)
8. **Phase V2.6** : embeddings (si benchmark valide le gain)

## Risques et mitigation

### Risque R-01 : Corruption du cache V1 par le catalogue V2

**Mitigation** : séparation stricte des tables, migrations V2 en série distincte (V2xx), tests de non-régression V1 systématiques.

### Risque R-02 : Performance FTS5 insuffisante sur gros catalogue

**Mitigation** : limiter taille catalogue V2 initial (ex: 100 documents max), benchmark avant phase V2.2, index FTS5 optimisés.

### Risque R-03 : Synchronisation trop fréquente surcharge le serveur upstream

**Mitigation** : respect `robots.txt`, délai minimum entre requêtes, polling raisonnable (daily par défaut), rate limiting.

### Risque R-04 : Breaking change SDK MCP v2 bloque développement

**Mitigation** : évaluation SDK en phase V2.0, possibilité de rester sur v1.29.0 si v2 instable, migration SDK comme phase séparée.

### Risque R-05 : Embeddings trop lents ou imprécis

**Mitigation** : phase V2.6 optionnelle et conditionnée par benchmark, FTS5 reste le socle stable, embeddings uniquement si gain démontré.

## Définition de « V2 opérationnelle »

La V2 est considérée opérationnelle lorsque :

- Les cinq critères d'acceptation AC-V2-01 à AC-V2-05 sont validés avec preuves
- Les trois nouveaux outils MCP V2 sont détectables dans Copilot
- Les deux outils V1 restent fonctionnels (tests E2E V1 verts)
- La synchronisation manuelle via CLI est documentée et testée
- Le catalogue contient au moins 10 documents de test indexés
- La recherche FTS5 retourne des résultats pertinents classés
- Aucune régression V1 n'est introduite

## Références

- [ADR-010 — Préparer la V2 avec SQLite FTS5](../adr/ADR-010-v2-sqlite-fts5.md)
- [ADR-011 — Figer la frontière V1/V2](../adr/ADR-011-v1-v2-boundary.md)
- [ADR-012 — Planifier la migration SDK MCP v2](../adr/ADR-012-migration-sdk-mcp-v2.md)
- [Roadmap V1 opérationnelle](roadmap-v1-operationnelle.md)
- [SQLite FTS5 Documentation](https://www.sqlite.org/fts5.html)
- [BM25 Scoring](https://en.wikipedia.org/wiki/Okapi_BM25)

