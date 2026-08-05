# ADR-012 — Planifier la migration SDK MCP v2 hors périmètre V1

- **Statut** : Historique — gel V1 exécuté, suivi par ADR-013
- **Date** : 27 juin 2026
- **Réconciliation courante** : candidat `1.1.0` sur `@modelcontextprotocol/sdk@1.30.0`

## Contexte

Au moment de cette décision, le projet utilisait `@modelcontextprotocol/sdk@1.29.0`, version de la
génération 1.x du SDK MCP TypeScript vérifiée le 22 juin 2026 dans l'ADR-002.

Cette version fournissait les primitives STDIO nécessaires :

- `McpServer` pour créer le serveur
- `StdioServerTransport` pour le transport local
- `registerTool(...)` pour déclarer les outils
- `structuredContent` pour les réponses riches
- Validation des schémas d'entrée/sortie

Le dépôt officiel du SDK MCP TypeScript ([modelcontextprotocol/typescript-sdk](https://github.com/modelcontextprotocol/typescript-sdk)) indique qu'une génération v2 du SDK pourrait introduire des packages séparés ou des breaking changes architecturaux.

Au 27 juin 2026, la V1 de mcp-search-net est officiellement close avec tous les critères d'acceptation validés. Avant d'entamer le développement V2 (catalogue documentaire, FTS5, synchronisation, embeddings), il est nécessaire d'évaluer si une migration SDK MCP v2 est requise.

## Décision

1. **Geler le SDK MCP v1.29.0 pour toute la V1** : aucune migration SDK ne sera effectuée pendant le cycle V1. La version 1.29.0 reste épinglée dans `package.json` et `package-lock.json`.

2. **Évaluer la migration SDK v2 avant tout développement V2** : avant de commencer les phases V2 (catalogue, FTS, synchronisation), vérifier l'état du SDK MCP :
   - Consulter les releases officielles sur [GitHub releases](https://github.com/modelcontextprotocol/typescript-sdk/releases)
   - Lire les release notes et migration guides
   - Identifier les breaking changes affectant STDIO, `registerTool`, et `structuredContent`
   - Confirmer que la v2 est stable et recommandée pour la production

3. **Conditions de migration vers SDK v2** :
   - SDK v2 officiellement stable (pas alpha/bêta/RC)
   - Release notes analysées et breaking changes documentés
   - Migration guide officiel disponible
   - Tests de non-régression STDIO complets
   - Pas de breaking change affectant les contrats publics V1 gelés (ADR-011)
   - Primitive STDIO équivalente (`StdioServerTransport` ou équivalent)

4. **Planification de la migration** :
   - Si la v2 SDK est stable au démarrage V2 : créer une phase V2.0 dédiée « Migration SDK MCP v2 »
   - Si la v2 SDK n'est pas encore stable : rester sur v1.29.0 jusqu'à stabilisation
   - Si la v2 SDK introduit des breaking changes majeurs : évaluer coût/bénéfice avant migration

5. **Tâches de migration (si applicable)** :
   - Mettre à jour `package.json` et `package-lock.json`
   - Adapter les imports dans `src/presentation/mcp/mcp-server.ts` et `src/bootstrap/main.ts`
   - Mettre à jour les tests E2E MCP STDIO
   - Valider que les deux outils V1 restent fonctionnels
   - Mettre à jour ADR-002 avec la nouvelle version
   - Re-exécuter la suite complète `npm run check` et `npm run test:e2e`

## Réconciliation avec le candidat `1.1.0`

Le gel `1.29.0` a protégé le cycle V1 comme prévu. Le candidat courant utilise désormais
`@modelcontextprotocol/sdk@1.30.0`, toujours épinglé exactement dans `package.json` et
`package-lock.json`. Cette mise à jour compatible de la génération 1.x ne constitue pas la migration
architecturale vers une future génération SDK v2 envisagée par cette ADR.

Le serveur candidat conserve le transport STDIO et expose les cinq outils read-only
`search_web`, `fetch_url`, `search_docs`, `list_docs`, `read_doc_section`, ainsi que ses resources et
templates. La décision applicable au démarrage V2 et à cette mise à jour reste ADR-013. Les
validations datées de la V1 prouvent leurs SHA historiques, pas le candidat courant ; son verdict est
maintenu séparément dans [`docs/status/current-state.md`](../status/current-state.md).

## Conséquences

### Positives

- **Stabilité V1** : la V1 reste sur une version SDK éprouvée et stable
- **Risques réduits** : aucun breaking change SDK pendant le cycle V1
- **Contrats gelés** : les outils `search_web` et `fetch_url` restent stables
- **Préparation V2** : la migration SDK devient un pré-requis clairement identifié avant développement V2

### Négatives

- **Dette technique potentielle** : si la v2 SDK apporte des améliorations significatives, la V1 n'en bénéficiera pas
- **Migration obligatoire** : si la v1 SDK devient deprecated, une migration forcée sera nécessaire

### Neutralisation des risques

- Surveiller les releases officielles du SDK MCP TypeScript
- Lire les deprecation notices dans les release notes
- Planifier la migration SDK v2 comme première phase du développement V2
- Documenter la décision de migration dans un ADR dédié (potentiel ADR-013)

## Alternatives considérées

### Alternative A : Migrer vers SDK v2 immédiatement

**Avantages** : bénéficier des dernières fonctionnalités SDK  
**Inconvénients** : risque de breaking changes, tests de non-régression lourds, retarde la clôture V1

**Rejet** : la V1 est complète et validée. Introduire une migration SDK maintenant retarderait la clôture officielle sans bénéfice immédiat.

### Alternative B : Ignorer la migration SDK v2

**Avantages** : pas de coût de migration  
**Inconvénients** : risque d'obsolescence, incompatibilité future

**Rejet** : nécessite une évaluation active avant V2, pas une ignorance totale.

### Alternative C : Planifier la migration (décision retenue)

**Avantages** : flexibilité, migration conditionnelle, stabilité V1, préparation V2  
**Inconvénients** : nécessite une phase d'évaluation au début de V2

## Références

- [ADR-002 — Utiliser le transport MCP STDIO](ADR-002-mcp-stdio.md)
- [ADR-011 — Figer la frontière V1/V2](ADR-011-v1-v2-boundary.md)
- [SDK MCP TypeScript](https://github.com/modelcontextprotocol/typescript-sdk)
- [Release v1.29.0](https://github.com/modelcontextprotocol/typescript-sdk/releases/tag/v1.29.0)
- [Release v1.30.0](https://github.com/modelcontextprotocol/typescript-sdk/releases/tag/v1.30.0)
- [Documentation officielle MCP](https://modelcontextprotocol.io)
