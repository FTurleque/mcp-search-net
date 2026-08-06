# Remédiation de l'audit — 6 août 2026

## Périmètre

Cette preuve de travail concerne la branche `agent/full-audit-remediation`, créée depuis le dernier
head commun `master` / `develop` qualifié :

```text
44e73d32abe7bd585fe9f9845fecdd0c66604e3b
```

PR : #37. Issue de coordination : #36. Issues spécialisées : #32, #33, #34.

Ce document décrit le travail de branche ; il ne remplace pas `docs/status/current-state.md`, qui
reste la source de vérité du produit mergé.

## Implémentation terminée sur la branche

### Sécurité Web

- parsing `robots.txt` par groupes `User-agent` ;
- groupes adjacents non fusionnés ;
- groupe produit spécifique préféré au wildcard ;
- fallback de connexion entre adresses DNS publiques préalablement approuvées ;
- aucune nouvelle résolution entre validation et connexion ;
- blocage IPv6 étendu aux préfixes spéciaux de traduction, tunnel et documentation ;
- sanitization Crawl4AI étendue à SVG, MathML, canvas et attributs de chargement supplémentaires ;
- conteneur Crawl4AI retiré du réseau `egress` et limité à `backend`.

### Supply chain et runtime

- Node.js 24.18.0 aligné sur CI, Docker, Windows, `.nvmrc` et `.node-version` ;
- image Docker Node 24.18.0 figée par digest ;
- `strict-allow-scripts=true` ;
- scripts lifecycle limités aux versions explicitement autorisées ;
- contrôle supply-chain étendu à l'allowlist ;
- Inno Setup/ISCC 6.7.1 vérifié avant compilation de release.

Le premier run ayant réellement démarré les étapes a démontré que le nouveau gate lifecycle est
actif : `npm ci` a refusé `fsevents@2.3.3` tant que cette dépendance optionnelle n'avait pas été
ajoutée explicitement à l'allowlist.

### Catalogue SQLite — #33

`SqliteCatalogRepository` est maintenant une façade sur :

```text
SqliteCatalogSourceStore
SqliteCatalogReadModel
SqliteCatalogRevisionWriter
SqliteCatalogSearch
SqliteCatalogSyncStore
```

Toutes ces responsabilités partagent la même connexion SQLite. La révision documentaire courante
reste un commit atomique unique couvrant document, version, sections, FTS, pointeur courant et
observations. Les migrations C001-C008 ne sont pas modifiées.

### Recherche locale — #32

- jeu de requêtes renforcé à 60 cas ;
- benchmark local embeddings research-only ;
- modèle, révision, licence et dimension enregistrés ;
- comparaison lexical / embeddings / RRF ;
- métriques qualité et performance définies ;
- workflow exact-head dédié ;
- aucune dépendance modèle/Python ajoutée au runtime produit ;
- ADR-018 créé avec statut `Proposé` tant qu'aucune mesure n'a été produite.

### Contrat clients — #34

- rapport MCP STDIO déterministe ajouté au gate `check` ;
- vérification exacte de 5 tools, 4 resources et 9 resource templates ;
- contrôle `schemaVersion = 1.0` et annotations ;
- preuve du client de référence explicitement distinguée des intégrations natives tierces ;
- matrice de certification manuelle documentée.

### Bootstrap

- ancien module vide `crawl4ai-auth.ts` supprimé ;
- garde Node isolée dans un module testable ;
- tests directs ajoutés pour les runtimes supportés/non supportés ;
- les parcours CLI catalogue restent couverts par les suites d'intégration existantes.

## Qualification GitHub Actions

### Run avec étapes exécutées

Le premier run de cette remédiation a réellement exécuté `npm ci` et a échoué sur le nouveau gate
`allowScripts`, ce qui a permis d'ajouter l'unique dépendance optionnelle manquante à la liste revue.

### Blocage actuel

Les runs suivants, y compris les tentatives les plus récentes, échouent avant toute première étape :

```text
steps    = null
logs_url = null
logs     = indisponibles
```

Ce symptôme touche simultanément les trois jobs du workflow CI historique et le workflow de benchmark
nouvellement ajouté. Aucun test, build, `npm ci`, Docker ou script Windows du head concerné n'est
alors lancé.

Il est donc incorrect de conclure :

```text
CI PASS
CI FAIL logiciel
benchmark embeddings mesuré
#33 qualifié
```

Le verdict correct est : **qualification executable bloquée avant démarrage des runners**.

## Gate de merge

La PR #37 doit rester draft. Elle ne doit être mergée qu'après :

1. exécution réelle de `npm run check` et des suites déterministes sur le SHA exact ;
2. PASS Docker integration + live E2E ;
3. PASS Windows installation/packaging ;
4. exécution et archivage du benchmark #32 ;
5. mise à jour d'ADR-018 avec la décision mesurée ;
6. réconciliation de `docs/status/current-state.md` seulement après qualification ;
7. requalification du SHA exact de `master` après merge avant réalignement de `develop`.

Les observations natives des interfaces tierces de #34 restent un gate manuel séparé et ne doivent
jamais être déduites de la seule sonde STDIO.
