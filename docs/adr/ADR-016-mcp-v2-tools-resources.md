# ADR-016 — Exposer la V2 avec un outil de recherche et des resources MCP

- **Statut** : Accepté pour V2.0, à confirmer par spike IntelliJ/Copilot
- **Date** : 2026-07-03
- **Décision liée** : ADR-002, ADR-011, ADR-013

## Contexte

La V1 expose exactement deux outils MCP : `search_web` et `fetch_url`.

La V2 ajoute un catalogue documentaire local. Elle doit permettre de rechercher dans ce catalogue et de fournir du contexte documentaire stable sans transformer les opérations de synchronisation en actions librement appelables par le LLM.

MCP supporte les outils et les resources. Les outils conviennent aux actions calculées ou paramétrées. Les resources conviennent à l'exposition de données adressables et lisibles.

## Décision

La V2 doit privilégier une exposition mixte :

1. un outil MCP de recherche documentaire ;
2. des resources MCP pour exposer les sources, documents, versions et sections.

Nom provisoire de l'outil :

```text
search_docs
```

`search_catalog` reste un alias candidat. Le nom final sera gelé après spike IntelliJ/Copilot.

## Outil proposé

```typescript
interface SearchDocsInput {
  query: string;
  sourceIds?: string[];
  documentIds?: string[];
  versionPolicy?: 'current' | 'all' | 'specific';
  version?: string;
  languages?: string[];
  publishedAfter?: string;
  maxResults?: number;
  maxCharacters?: number;
}
```

Sortie attendue :

- enveloppe commune versionnée ;
- `requestId` ;
- statut de cache/index ;
- résultats classés ;
- extraits courts ;
- liens vers resources documentaires ;
- warnings séparés.

## Resources proposées

```text
mcp-search-net://catalog
mcp-search-net://sources
mcp-search-net://sources/{sourceId}
mcp-search-net://documents/{documentId}
mcp-search-net://documents/{documentId}/versions
mcp-search-net://documents/{documentId}/versions/{versionId}
mcp-search-net://sections/{sectionId}
```

Les resources sont read-only.

## Ce qui reste hors MCP

Les opérations suivantes restent CLI/worker, pas outils MCP libres :

```text
catalog init
catalog add-source
catalog sync
catalog rebuild-index
catalog purge-versions
```

La commande `catalog status` peut être exposée indirectement via resource read-only si elle ne déclenche aucune mutation.

## Spike obligatoire

Avant de figer le contrat MCP V2, exécuter un spike IntelliJ/Copilot :

1. vérifier que l'IDE liste les resources ;
2. vérifier que l'IDE peut lire une resource ;
3. vérifier que le modèle peut exploiter un URI de resource dans une réponse ;
4. vérifier l'ergonomie par rapport à un outil read-only ;
5. documenter les limites.

Si les resources ne sont pas exploitables correctement dans IntelliJ/Copilot, ajouter temporairement des outils read-only de secours :

```text
list_catalog_sources
get_document_version
read_document_section
```

Ces outils de secours ne doivent pas déclencher de synchronisation.

## Règles de compatibilité V1

- `search_web` reste inchangé.
- `fetch_url` reste inchangé.
- Les codes d'erreur V1 restent stables.
- Le serveur peut exposer plus de deux capacités en V2, mais les tests V1 doivent continuer à passer dans un mode de compatibilité V1 ou être adaptés explicitement pour la V2.

## Conséquences

### Positives

- Un seul outil principal pour la recherche.
- Resources adaptées aux documents stables.
- Moins de surface d'action mutable exposée au LLM.
- Bon alignement avec le caractère read-only du catalogue.

### Négatives

- Compatibilité IntelliJ/Copilot à vérifier.
- Documentation plus riche à produire.
- Tests E2E MCP plus complets.

## Critères d'acceptation avant implémentation

- Nom final `search_docs` ou `search_catalog` choisi.
- Spike resources documenté.
- Schémas d'entrée/sortie proposés.
- Budget de contexte défini.
- Tests E2E prévus pour tools et resources.
