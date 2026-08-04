# État courant de `mcp-search-net`

Ce document est l’état technique autoritatif du checkout courant. Les fichiers datés de
`docs/planning/` restent des preuves historiques : ils ne décrivent pas automatiquement la
capacité ou le statut du candidat présent.

## Version et statut de livraison

- Jalon produit : V2 documentaire.
- Version SemVer : `1.1.0`.
- Règle : V2 est un jalon produit additif ; les contrats V1 restent exposés, donc le prochain
  incrément SemVer est mineur et non `2.0.0`.
- Release publiée : aucune release V2/1.1.0 à ce jour ; `v1.0.0` reste la dernière release.
- Verdict production : **NO-GO tant que tous les gates exact-head ne sont pas enregistrés**.
- GitHub Actions : aucun run ne prouve les têtes actuelles. Le blocage de facturation observé le
  4 juillet 2026 est historique ; son état actuel est inconnu.

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

Le workflow documentaire attendu est `search_docs` puis `read_doc_section`. `fetch_url` et
`search_web` restent réservés au Web frais ou absent du catalogue. Les resources/templates sont
un canal de lecture complémentaire ; leur rendu dépend du client MCP.

## Stockage et migrations catalogue

`cache.sqlite` est le cache Web V1. `catalog.db` est le catalogue documentaire persistant V2 ;
ils sont isolés et ont des cycles de sauvegarde/rétention distincts. Les migrations appliquées
dans l’ordre sont :

- `C001__create_catalog_sources.sql`
- `C002__create_documents.sql`
- `C003__create_document_versions.sql`
- `C004__create_document_sections.sql`
- `C005__create_sync_tracking.sql`
- `C006__create_document_section_fts.sql`
- `C007__harden_revision_integrity.sql`
- `C008__add_catalog_pagination_indexes.sql`

Une migration appliquée n’est jamais réécrite : toute évolution crée le numéro suivant.

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

Les anciens alias `MCP_SEARCH_*` sont uniquement des compatibilités transitoires déjà présentes
dans le chargeur ; ils ne doivent pas être introduits dans une nouvelle installation. Les CLI
catalogue acceptent aussi `MCP_CATALOG_PATH` et leurs options `--path` documentées.

## Surfaces et qualification

| Surface                          | État courant                                       | Preuve exigée avant GO                                                                                   |
| -------------------------------- | -------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Node.js 24 / STDIO Windows       | Qualifiable localement                             | `npm run check`, suites requises et vrai échange MCP sur le SHA final                                    |
| IntelliJ IDEA + GitHub Copilot   | À requalifier sur le SHA final                     | serveur Running, cinq outils, workflow `search_docs` → `read_doc_section`, limites resources relevées    |
| Codex Desktop                    | Non configuré dans la tâche d’audit du 4 août 2026 | nouvelle tâche après ajout MCP ; sinon verdict `NON DISPONIBLE`, jamais PASS via un client STDIO externe |
| Docker/Linux                     | À requalifier sur le SHA final                     | build, santé providers, E2E live, persistance catalogue, inspection réseau/utilisateur/filesystem        |
| Installation utilisateur Windows | À requalifier sur installation propre              | install/upgrade/désinstall, launchers host et conteneur, catalogue et opérations réelles                 |
| GitHub Actions                   | Non prouvé sur les têtes actuelles                 | run attaché au SHA final ; un résultat historique ne vaut pas preuve                                     |

## Gates de livraison

Un GO nécessite simultanément : worktree propre, SHA exact enregistré, `npm run check`, toutes les
suites déterministes sans skip, audits npm complets et production, qualification Windows, Docker,
installation utilisateur, client IntelliJ/Copilot, puis CI GitHub attachée au même candidat. Une
capacité non observée est notée `NON DISPONIBLE` ou `NON PROUVÉE`, jamais convertie en PASS.
