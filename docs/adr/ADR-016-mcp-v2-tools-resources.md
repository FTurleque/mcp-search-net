# ADR-016 — Exposer la V2 avec un outil de recherche et des resources MCP

- **Statut** : Accepté, implémentation initiale en cours dans la PR #8
- **Date** : 2026-07-03
- **Dernière mise à jour** : 2026-07-05
- **Décision liée** : ADR-002, ADR-011, ADR-013

## Contexte

La V1 expose exactement deux outils MCP : `search_web` et `fetch_url`.

La V2 ajoute un catalogue documentaire local. Elle doit permettre de rechercher dans ce catalogue et de fournir du contexte documentaire stable sans transformer les opérations de synchronisation en actions librement appelables par le LLM.

MCP supporte les outils et les resources. Les outils conviennent aux actions calculées ou paramétrées. Les resources conviennent à l'exposition de données adressables et lisibles.

## Décision

La V2 doit privilégier une exposition mixte :

1. un outil MCP de recherche documentaire ;
2. des resources MCP pour exposer les sources, documents, versions et sections.

Nom retenu pour l'implémentation initiale :

```text
search_docs
```

`search_catalog` reste un alias possible plus tard, mais n'est pas nécessaire pour la première exposition V2.

## Outil implémenté

```text
search_docs
```

L'outil est read-only et recherche dans le catalogue documentaire local. Il ne déclenche aucune synchronisation, purge ou reconstruction d'index.

## Resources implémentées ou en cours de stabilisation

```text
mcp-search-net://catalog
mcp-search-net://sources
mcp-search-net://sources/{sourceId}
mcp-search-net://documents
mcp-search-net://documents/{documentId}
mcp-search-net://documents/{documentId}/versions
mcp-search-net://documents/{documentId}/versions/{versionId}
mcp-search-net://sections
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

## État d'implémentation PR #8

- `search_docs` est implémenté.
- Les resources statiques catalogue/sources/documents/sections sont implémentées.
- Les templates dynamiques sources/documents/sections sont implémentés.
- Les templates dynamiques de versions documentaires sont récupérés dans la PR #8.
- Les opérations mutables restent hors MCP.
- Le workflow GitHub Actions est temporairement manuel uniquement à cause du quota Actions minutes.
- Le head courant de la PR #8 doit être revalidé localement ou via CI manuelle après reset du quota.

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

- Un seul outil principal pour la recherche documentaire.
- Resources adaptées aux documents stables.
- Moins de surface d'action mutable exposée au LLM.
- Bon alignement avec le caractère read-only du catalogue.

### Négatives

- Compatibilité IntelliJ/Copilot à vérifier.
- Documentation plus riche à maintenir.
- Tests E2E MCP plus complets.
- Validation complète du head courant différée tant que le quota Actions est épuisé.

## Critères d'acceptation avant gel définitif

- Spike resources IntelliJ/Copilot exécuté.
- Budget de contexte confirmé.
- Tests E2E tools/resources verts sur le head final.
- Contrats V1 `search_web` et `fetch_url` non régressés.
