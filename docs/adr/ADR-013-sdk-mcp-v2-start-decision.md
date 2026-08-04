# ADR-013 — Conserver le SDK MCP V1 au démarrage de la V2

- **Statut** : Accepté — démarrage V2 exécuté, mise à jour compatible `1.30.0`
- **Date** : 2026-07-03
- **Réconciliation courante** : 2026-08-04, candidat `1.1.0`
- **Décision liée** : ADR-002, ADR-011, ADR-012

## Contexte

La V1 validée utilisait `@modelcontextprotocol/sdk@1.29.0` avec le transport STDIO, `McpServer`,
`StdioServerTransport`, `registerTool(...)`, schémas Zod et `structuredContent`.

Les contrats publics V1 sont gelés par l'ADR-011 : `search_web` et `fetch_url` doivent rester disponibles, stables et non régressifs pendant l'étude et l'implémentation V2.

L'ADR-012 impose d'évaluer une éventuelle génération SDK MCP V2 avant de l'adopter, mais ne rend pas cette migration obligatoire pour démarrer le cadrage V2.

## Décision

La V2.0 a démarré en conservant `@modelcontextprotocol/sdk@1.29.0`.

Aucune migration SDK MCP n'est réalisée dans la phase V2.0.

Une migration vers une génération SDK MCP différente ne pourra être décidée qu'après :

1. consultation des releases officielles ;
2. identification d'une version stable de production ;
3. lecture d'un guide de migration officiel ;
4. validation d'un prototype STDIO minimal ;
5. passage de tous les tests V1 ;
6. validation IntelliJ/Copilot ;
7. rédaction d'un nouvel ADR remplaçant explicitement cette décision.

## Justification

La priorité V2.0 est de cadrer le catalogue documentaire, l'isolation `catalog.db`, le schéma SQL, l'index FTS5, le benchmark et l'exposition MCP V2.

Migrer le SDK pendant ce cadrage introduirait un risque transversal sans bénéfice fonctionnel immédiat.

Le SDK retenu au démarrage suffisait pour :

- conserver les outils V1 ;
- ajouter plus tard un outil de recherche documentaire ;
- réaliser un spike de compatibilité resources MCP ;
- tester le serveur en STDIO.

## Réconciliation avec le candidat `1.1.0`

Le candidat courant épingle `@modelcontextprotocol/sdk@1.30.0`. Il s'agit d'une mise à jour de la
même génération 1.x, pas de la migration architecturale SDK v2 différée par ADR-012/ADR-013. Le
transport reste STDIO et les primitives `McpServer`, `StdioServerTransport`, `registerTool(...)` et
`structuredContent` restent celles utilisées par le code.

La surface serveur compte désormais exactement cinq outils read-only : `search_web`, `fetch_url`,
`search_docs`, `list_docs` et `read_doc_section`, plus quatre resources statiques et neuf templates.
Les preuves V1/V2 datées restent attachées à leurs SHA ; elles ne qualifient pas automatiquement ce
candidat, dont le statut est tenu dans [`docs/status/current-state.md`](../status/current-state.md).

## Conséquences

### Positives

- Pas de régression induite par le SDK pendant V2.0.
- Contrats V1 préservés.
- Étude V2 concentrée sur le modèle documentaire.
- CI et E2E existants restent pertinents.

### Négatives

- La V2.0 ne bénéficie pas d'éventuelles nouveautés SDK postérieures.
- Une migration ultérieure peut rester nécessaire.

### Neutralisation

- Créer une tâche dédiée de veille SDK avant la phase d'exposition MCP V2.
- Garder les tests E2E STDIO comme barrière de non-régression.
- Ne pas coupler les modèles V2 au SDK MCP.

## Critères de révision

Cette décision sera révisée si :

- le SDK V1 utilisé devient officiellement déprécié ;
- une version SDK plus récente devient stable et recommandée ;
- les resources MCP requises par la V2 ne sont pas correctement supportées par la version actuelle ;
- IntelliJ/Copilot impose une compatibilité différente.

La mise à jour compatible `1.29.0` vers `1.30.0` est la réconciliation de maintenance de cette
décision. Une migration de génération, une rupture STDIO ou une modification incompatible du
contrat public exigera toujours un nouvel ADR de remplacement.
