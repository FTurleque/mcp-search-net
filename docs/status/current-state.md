# État courant de `mcp-search-net`

Ce document décrit l’état technique autoritatif du produit courant. Les fichiers datés sous
`docs/planning/` sont des preuves historiques liées à leur date et à leur SHA ; ils ne remplacent
pas ce document pour connaître l’état présent.

## Version et statut de livraison

- Jalon produit : V2 documentaire intégrée.
- Version SemVer : `1.1.0`.
- Branche de référence : `master`.
- Intégration V2 : PR #8 mergée dans `master` le 5 août 2026.
- Hardening post-merge : PR #31 regroupe les corrections d’ownership Windows, de release, de
  provenance MCP, de passerelle HTTP et de réconciliation documentaire issues de l’audit V2.
- Release V2/1.1.0 : aucune publication n’est déclarée par ce document ; une publication doit
  passer la qualification exact-head et le workflow de release volontaire.
- Politique SemVer de release : le paramètre de publication, `package.json`, `package-lock.json`
  et la version embarquée doivent être identiques. Toute dérive bloque la publication.

La documentation courante ne transforme jamais un ancien résultat en PASS du head présent. La
preuve d’un candidat est portée par les checks GitHub attachés à son SHA exact et, pour les
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

## Limites connues

- la recherche locale de référence reste FTS5/BM25 ; le reranker lexical hashé n’apporte pas de
  gain mesuré et n’est pas généralisé ;
- le benchmark V2.13 montre une faiblesse forte sur les paraphrases et les questions multi-document ;
  toute évolution vers des embeddings locaux doit gagner un benchmark comparatif dédié ;
- l’affichage et l’usage direct des resources/templates dépendent du client MCP ; les cinq outils
  restent le contrat portable principal ;
- le serveur est un MCP STDIO local : il n’embarque aucun LLM et n’exige aucune API commerciale.

## Gouvernance Git post-V2

`master` est la source de vérité. L’historique squashé de la PR #8 ne doit jamais être réintégré via
un merge brut de l’ancien `develop`. `develop` doit rester explicitement alignée sur le `master`
qualifié. La PR #27 est supersédée par cette règle. Les branches V2 absorbées n’ont plus vocation à
porter du travail unique et peuvent être retirées de la liste des branches actives.
