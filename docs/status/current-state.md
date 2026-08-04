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
- SHA candidat V2 : `de769ee5f0eed1f6fd7829a21496e69817e6d096` (2026-08-04), branche
  `codex/v2-production-readiness`.
- Verdict production : **NO-GO tant que le gate IntelliJ/Copilot n'est pas exécuté manuellement.
  La CI GitHub Actions est bloquée par facturation et ne peut pas valider le SHA courant.**
- GitHub Actions : blocage facturation confirmé le 2026-08-04 (`account payments have failed`).
  Les gates locaux (Node.js 24, STDIO, tests déterministes, npm audit) sont la source de vérité.

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

| Surface                          | État courant                                              | Preuve exigée avant GO                                                                                   |
| -------------------------------- | --------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Node.js 24 / STDIO Windows       | **PASS** — SHA 912df9f, 2026-08-04                        | `npm run check` (264+), Gate A STDIO, audits npm 0 vulnérabilité                                        |
| IntelliJ IDEA + GitHub Copilot   | **PASS AVEC RÉSERVE** — recette fournie, non exécutée     | Exécuter recette `validation-v2-14-client-contracts.md` §Gate B (config mcp.json + vérification)        |
| Claude Desktop / Codex           | **NON DISPONIBLE** — non configuré dans mcpServers        | Configurer `mcpServers` dans claude_desktop_config.json si requis ; recette fournie                      |
| Docker/Linux                     | **PASS** — SHA de769ee, 2026-08-04                        | Phase F : `docker compose build`, OCI labels, user/caps/fs, E2E live 7/7 PASS, shutdown propre          |
| Installation utilisateur Windows | **PASS** — SHA b1072d5, 2026-08-04                        | Phase G : test-installation.ps1 INSTALLATION_LIFECYCLE_VALID ; signature Node.js OpenJS Foundation ✓ ; probe MCP STDIO ✓ ; rollback ✓ ; upgrade (préserve config/données) ✓ ; uninstall -KeepData ✓ ; désinstall complet ✓ |
| GitHub Actions                   | **BLOQUÉ — facturation** — `account payments have failed`     | Résoudre le problème de facturation dans Billing & plans ; CI ne peut pas valider le SHA 7d6b43e     |

## Gates de livraison

Un GO nécessite simultanément : worktree propre, SHA exact enregistré, `npm run check`, toutes les
suites déterministes sans skip, audits npm complets et production, qualification Windows, Docker,
installation utilisateur, client IntelliJ/Copilot, puis CI GitHub attachée au même candidat. Une
capacité non observée est notée `NON DISPONIBLE` ou `NON PROUVÉE`, jamais convertie en PASS.

## Progrès gates V2.14 — 2026-08-04 SHA 912df9f

| Gate | Verdict | Preuve |
|---|---|---|
| A — STDIO de référence | **PASS** | probe SDK MCP inline : 5 outils, 4 resources, 9 templates, schemaVersion=1.0 |
| B — IntelliJ/Copilot | **PASS AVEC RÉSERVE** | recette fournie, non exécutée — mcp.json absent |
| C — Claude Desktop | **NON DISPONIBLE** | mcpServers inspecté : seul minos configuré |
| D — Logiciel exact-head | **PASS** | 264/113/6/74/25/2/42/2 tests, 0 npm vuln, 85.38% functions |
| F — Docker/Linux | **PASS** | image `mcp-search-net:1.1.0` construite SHA de769ee ; OCI labels vérifiés ; user node uid=1000 ; CapEff=0 ; read_only + tmpfs ; catalog.db persisté ; E2E live 7/7 PASS (searxng + crawl4ai + stdio) ; shutdown propre |
| G — Installation Windows | **PASS** | `test-installation.ps1 INSTALLATION_LIFECYCLE_VALID` sur SHA b1072d5 ; signature Authenticode Node.js valide (OpenJS Foundation) ; probe MCP STDIO ✓ ; rollback ✓ ; upgrade préserve config/données ✓ ; uninstall -KeepData ✓ ; désinstall complet ✓ |
