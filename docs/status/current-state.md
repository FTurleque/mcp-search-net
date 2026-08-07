# État courant de `mcp-search-net`

Ce document décrit l’état technique autoritatif du produit courant. Les fichiers datés sous
`docs/planning/` sont des preuves historiques liées à leur date et à leur SHA ; ils ne remplacent
pas ce document pour connaître l’état présent.

## Version et statut de livraison

- Jalon produit : V2 documentaire intégrée et hardening post-audit livré.
- Version SemVer : `1.1.0`.
- Branche de référence : `master`.
- Intégration V2 : PR #8 mergée dans `master` le 5 août 2026.
- Hardening post-merge initial : PR #31 regroupe les corrections d’ownership Windows, de release,
  de provenance MCP, de passerelle HTTP et de réconciliation documentaire issues de l’audit V2.
- Hardening post-audit complet : PR #37 mergée dans `master` le 6 août 2026. Elle livre le
  durcissement réseau/Crawl4AI, l’alignement supply-chain Node 24.18.0, le découpage interne du
  repository SQLite, le benchmark embeddings local et le gel déterministe du contrat client MCP.
- Baseline qualifiée de la PR #37 : head fonctionnel
  `cbc9b58d0c948da2ed840a8245c3aafa494e67b7`, qualification CI run `31126841127`. Le merge commit
  `005bf913de75feeb78ae7c9d23d60e7b93d210c0` n’introduit aucun changement de contenu par rapport
  à ce head.
- Release V2/1.1.0 : aucune publication n’est déclarée par ce document ; une publication doit
  passer la qualification exact-head et le workflow de release volontaire.
- Politique SemVer de release : le paramètre de publication, `package.json`, `package-lock.json`
  et la version embarquée doivent être identiques. Toute dérive bloque la publication.

La documentation courante ne transforme jamais un ancien résultat en PASS du head présent. La
preuve d’un nouveau candidat est portée par les checks GitHub attachés à son SHA exact et, pour les
surfaces manuelles, par une recette datée explicitement reliée à ce SHA.

## Contrat MCP public

Le serveur STDIO expose exactement cinq outils read-only :

- `search_web`
- `fetch_url`
- `search_docs`
- `list_docs`
- `read_doc_section`

Les quatre resources statiques sont :

- `mcp-search-net://catalog`
- `mcp-search-net://sources`
- `mcp-search-net://documents`
- `mcp-search-net://sections`

Les neuf resource templates sont :

- `mcp-search-net://sources/page/{offset}`
- `mcp-search-net://sources/{sourceId}`
- `mcp-search-net://documents/page/{offset}`
- `mcp-search-net://documents/{documentId}`
- `mcp-search-net://documents/{documentId}/versions`
- `mcp-search-net://documents/{documentId}/versions/page/{offset}`
- `mcp-search-net://documents/{documentId}/versions/{versionId}`
- `mcp-search-net://sections/page/{offset}`
- `mcp-search-net://sections/{sectionId}`

Le workflow documentaire recommandé est `search_docs` puis `read_doc_section` sur une à trois
sections utiles. `search_web` et `fetch_url` servent au Web frais ou absent du catalogue. Les
resources/templates sont un canal read-only complémentaire dont l’ergonomie dépend du client MCP.

Toutes les réponses issues du Web ou du catalogue sont marquées comme contenu externe non fiable ;
le serveur n’exécute jamais le contenu récupéré comme instruction.

La sonde STDIO de référence gèle cinq tools, quatre resources et neuf templates avec
`schemaVersion = 1.0`. La certification native IntelliJ/Copilot, Claude Desktop/Code, Copilot CLI et
Codex reste séparée dans l’issue #34 : elle exige une observation réelle du client et ne peut pas
être déduite de la seule sonde STDIO.

## Stockage et migrations catalogue

`cache.sqlite` est le cache Web V1. `catalog.db` est le catalogue documentaire persistant V2. Ces
fichiers sont isolés et n’ont pas la même politique de rétention.

Les migrations catalogue appliquées dans l’ordre sont :

- `C001__create_catalog_sources.sql`
- `C002__create_documents.sql`
- `C003__create_document_versions.sql`
- `C004__create_document_sections.sql`
- `C005__create_sync_tracking.sql`
- `C006__create_document_section_fts.sql`
- `C007__harden_revision_integrity.sql`
- `C008__add_catalog_pagination_indexes.sql`

Une migration appliquée est immuable. Toute évolution crée une nouvelle migration.

`SqliteCatalogRepository` est une façade stable construite autour d’une connexion SQLite unique et
sépare les responsabilités source/read-model/révision/recherche/synchronisation. Une révision
courante reste une transaction atomique couvrant document, version, sections, FTS, pointeur courant
et observations.

## Recherche locale et décision embeddings

FTS5/BM25 reste la stratégie de recherche du runtime produit. Le reranker lexical hashé historique
n’apporte aucun gain mesuré et n’est pas généralisé.

Le benchmark embeddings de #32 est terminé. Résultats officiels du run `31124100736`, SHA
`72b65a12786081d4e1fbc795fd8764dd4c81fd51`, sur 10 sources / 100 documents / 10 000 sections /
60 requêtes :

| Métrique                 |  Lexical | Embeddings locaux | Fusion RRF |
| ------------------------ | -------: | ----------------: | ---------: |
| Recall@10                |   0.6167 |            0.8528 |     0.8528 |
| MRR@10                   |   0.6167 |            0.9500 |          — |
| nDCG@10                  |   0.6167 |            0.8724 |          — |
| Paraphrase Recall@10     |        0 |              0.70 |       0.70 |
| Multi-document Recall@10 |        0 |            0.4167 |     0.4167 |
| p95                      | ~17.3 ms |          2.756 ms |  28.216 ms |

Décision ADR-018 : `prototype-local-vector-index`. Ces résultats justifient un prototype produit
séparé mais **pas** l’intégration immédiate des embeddings dans le runtime :
`adoptEmbeddingRuntimeNow: false`. Aucune dépendance Python, modèle ou index vectoriel n’est donc
ajoutée au serveur courant.

Le workflow GitHub Actions one-shot utilisé pour produire cette preuve n’est pas une capacité CI
pérenne : une fois l’étude terminée, la preuve historique reste dans #32/#37 et le harness
`scripts/benchmark-local-embeddings.py` peut être réutilisé explicitement pour un futur prototype.

## Variables serveur supportées

Variables déclarées par le schéma runtime :

- `MCP_CONFIG_PATH`
- `MCP_PROFILE`
- `MCP_LOG_LEVEL`
- `MCP_CACHE_PATH`
- `MCP_CATALOG_PATH`
- `MCP_OFFICIAL_SOURCES_PATH`
- `MCP_SEARXNG_URL`
- `MCP_CRAWL4AI_URL`
- `MCP_CRAWL4AI_TOKEN`
- `MCP_ALLOWED_PUBLIC_PORTS`

Les anciens alias `MCP_SEARCH_*` sont uniquement des compatibilités transitoires déjà présentes dans
le chargeur ; ils ne doivent pas être introduits dans une nouvelle installation.

## Installation Windows et ownership des clients

L’installateur génère des secrets locaux, démarre les fournisseurs Docker lorsque Docker est
opérationnel et peut configurer les clients détectés.

Règles de sécurité de configuration :

- une entrée MCP JSON préexistante et non suivie par l’installateur est conservée ;
- l’état `mcp-client-integrations.json` distingue `managed` et `preexisting` ;
- la désinstallation supprime uniquement les entrées suivies comme `managed` ;
- un JSON client existant mais invalide est traité en échec fermé : aucune réécriture silencieuse ;
- les fichiers sont sauvegardés avant toute modification gérée ;
- le nettoyage d’une ancienne clé JetBrains incorrecte n’est autorisé que lorsqu’elle pointe
  explicitement vers l’installation courante.

Le setup Inno et le script historique de désinstallation conservent les données utilisateur par
défaut. Dans le chemin historique, la suppression complète des données et volumes exige l’option
explicite `-PurgeData` ; `-KeepData` reste accepté comme alias de compatibilité du comportement sûr.

## Sécurité Web et exploitation

- chaque URL et chaque redirection est validée avant connexion ;
- les adresses DNS publiques approuvées sont épinglées et peuvent être essayées successivement sans
  nouvelle résolution DNS ;
- les plages IPv4/IPv6 privées, réservées, de traduction, tunnel et documentation sont bloquées ;
- Crawl4AI ne rejoint que le réseau Docker interne `backend` et n’expose aucun port hôte direct ;
- le mode hybride passe par un relais Node loopback minimal et durci vers `crawl4ai:11235` ;
- `robots.txt`, les budgets de taille/durée/redirections et les limites de concurrence restent
  appliqués par la passerelle HTTP ;
- l’historique de throttling par origine est borné afin qu’un processus long ne conserve pas une
  entrée mémoire pour un nombre illimité d’origines visitées ;
- le HTML envoyé au fallback natif Crawl4AI neutralise les attributs de chargement de ressources,
  y compris `srcdoc`, avant le transport `raw://` ;
- `pdfjs-dist` est fixé à `6.2.108` afin de sortir de la plage affectée par
  `GHSA-hq66-cqwq-w95j` (exécution JavaScript arbitraire sur PDF malveillant).

## CI et qualification

La CI s’exécute sur les pull requests et pushes vers `master` et `develop`. L’ancienne branche
d’intégration `feat/v2-catalog-storage` n’est plus une cible de workflow.

Le candidat de release doit passer sur le SHA exact :

```bash
npm ci
npm run check
npm run test:required
npm run test:unit
npm run test:contract
npm run test:security
npm run test:resilience
npm run test:performance
npm run test:integration
npm run test:e2e:deterministic
npm audit --audit-level=moderate
npm audit --omit=dev --audit-level=moderate
```

La CI ajoute la qualification Docker/live et le cycle Windows installation/upgrade/rollback/
uninstall. Le job Windows parse aussi les scripts PowerShell de packaging/release avant de lancer
le lifecycle. Un résultat d’un ancien SHA est une preuve historique, pas une qualification du
candidat présent.

Le workflow de publication Windows est manuel. Node.js win-x64 est vérifié par SHA-256 et la
toolchain Inno Setup est figée sur la version `6.7.1`.

## Limites connues et suites autorisées

- la recherche produit reste FTS5/BM25 jusqu’à qualification d’un prototype vectoriel séparé ;
- les résultats #32 autorisent l’étude `prototype-local-vector-index`, mais le prototype doit encore
  prouver persistance/rebuild, sync incrémentale, packaging Windows/Docker, redistribution du modèle,
  fonctionnement hors ligne et budget mémoire produit avant toute décision d’intégration ;
- l’affichage et l’usage direct des resources/templates dépendent du client MCP ; les cinq outils
  restent le contrat portable principal ;
- la certification native des clients reste ouverte dans #34 ;
- le serveur est un MCP STDIO local : il n’embarque aucun LLM et n’exige aucune API commerciale.

## Gouvernance Git post-V2

`master` est la source de vérité. L’historique squashé de la PR #8 ne doit jamais être réintégré via
un merge brut de l’ancien `develop`. `develop` doit rester explicitement alignée sur le `master`
qualifié. La PR #27 est supersédée par cette règle. Les branches absorbées n’ont plus vocation à
porter du travail unique et peuvent être retirées de la liste des branches actives.

## Réconciliation de qualification — audit du 7 août 2026

Le nouvel audit complet du HEAD `ec0c6969178e99b424468631e00082acf51e3014` a établi que le produit
avait conservé un socle runtime solide, mais que la gouvernance de qualification avait régressé :

- la PR #45 avait été mergée alors que son run exact-head `31162249594` était en échec sur le job
  `Node.js 24 validation` ;
- le Quality Gate SonarQube de cette PR avait signalé un `Security Rating E` sur le nouveau code ;
- la PR documentaire #46 avait été mergée sans qualification exact-head réussie ;
- quatre workflows one-shot terminés ou échoués, dont certains avec `contents: write`, restaient
  présents dans le dépôt ;
- le gate npm révélait ensuite l’advisory high `GHSA-hq66-cqwq-w95j` sur `pdfjs-dist@6.0.227`.

Ces résultats restent des preuves historiques de non-qualification et ne doivent jamais être
réinterprétés comme des PASS du produit courant.

L’issue #47 et la PR #48 portent la remédiation : suppression et interdiction déterministe des
workflows temporaires privilégiés, restauration des gates Node, propagation de
`strict-allow-scripts=true` dans Docker et le staging Windows, durcissement HTML/Crawl4AI, parsing
strict des resource URIs MCP, désinstallation historique safe-by-default, correction de l’identité
des sections SQLite hors chunking réel et mise à jour de PDF.js vers `6.2.108`.

La règle de sortie est stricte : le merge de cette remédiation n’est autorisé que si le HEAD final de
la PR réussit les jobs `Node.js 24 validation`, `Docker integration and live E2E` et
`Windows installation and STDIO packaging`, les deux audits npm et le Quality Gate SonarQube. Une
publication ultérieure depuis `master` exige de nouveau une preuve CI réussie attachée au SHA exact
de `master`. L’issue #34 reste séparée et ouverte pour la certification native réelle des clients
MCP interactifs.
