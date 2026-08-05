# ADR-016 — Exposer la V2 avec des outils ciblés et des resources MCP bornées

- **Statut** : Accepté — contrat du candidat `1.1.0`, gel V2.14 encore en qualification
- **Date** : 2026-07-03
- **Dernière mise à jour** : 2026-08-04
- **Décision liée** : ADR-002, ADR-011, ADR-013
- **Issue de gel client** : #17

## Contexte

La V1 expose exactement deux outils MCP : `search_web` et `fetch_url`.

La V2 ajoute un catalogue documentaire local. Elle doit permettre de rechercher dans ce catalogue et de fournir du contexte documentaire stable sans transformer les opérations de synchronisation en actions librement appelables par le LLM.

MCP supporte les outils et les resources. Les outils conviennent aux actions calculées ou paramétrées. Les resources conviennent à l'exposition de données adressables et lisibles.

## Décision

La V2 doit privilégier une exposition mixte :

1. un outil MCP de recherche documentaire compact ;
2. deux outils MCP read-only ciblés pour lister les documents et lire une section ;
3. des resources MCP paginées pour exposer les sources, documents, versions et sections.

Nom retenu pour la recherche documentaire :

```text
search_docs
```

Aucun alias `search_catalog` n'est exposé : le contrat candidat contient exactement les cinq noms
documentés ci-dessous.

## Outils implémentés

```text
search_web
fetch_url
search_docs
list_docs
read_doc_section
```

Les cinq outils sont read-only. Les deux premiers conservent le sous-contrat Web V1. `search_docs`
recherche dans le catalogue documentaire local, `list_docs` filtre et pagine en SQL, et
`read_doc_section` lit directement une section par identifiant. Aucun outil catalogue ne déclenche
de synchronisation, purge ou reconstruction d'index.

Le workflow agent recommandé et désormais couvert comme contrat ergonomique est :

```text
search_docs -> sélectionner 1 à 3 résultats -> read_doc_section
```

`fetch_url` est réservé au contenu Web frais ou non catalogué. `list_docs` sert au browsing de
métadonnées et ne doit pas remplacer `search_docs` pour une question de contenu.

## Annotations MCP gelées

Tous les outils sont :

```text
readOnlyHint = true
destructiveHint = false
idempotentHint = true
```

Les outils Web V1 sont open-world :

```text
search_web  openWorldHint = true
fetch_url   openWorldHint = true
```

Les outils catalogue V2 sont closed-world vis-à-vis du catalogue local :

```text
search_docs       openWorldHint = false
list_docs         openWorldHint = false
read_doc_section  openWorldHint = false
```

## Resources implémentées

Resources statiques :

```text
mcp-search-net://catalog
mcp-search-net://sources
mcp-search-net://documents
mcp-search-net://sections
```

Templates :

```text
mcp-search-net://sources/page/{offset}
mcp-search-net://sources/{sourceId}
mcp-search-net://documents/page/{offset}
mcp-search-net://documents/{documentId}
mcp-search-net://documents/{documentId}/versions
mcp-search-net://documents/{documentId}/versions/page/{offset}
mcp-search-net://documents/{documentId}/versions/{versionId}
mcp-search-net://sections/page/{offset}
mcp-search-net://sections/{sectionId}
```

Les resources sont read-only. Les collections retournent 20 éléments, une resource sérialisée est
limitée à 24 000 caractères et une section détaillée à 8 000. Les lectures par identifiant et les
pages utilisent des opérations repository dédiées ; elles ne chargent pas le catalogue complet.

## Politique `schemaVersion`

Les succès outils et les resources JSON V2 exposent actuellement :

```text
schemaVersion = "1.0"
```

Tant que cette version reste `1.0` :

- les consommateurs V1/V2 existants doivent continuer à fonctionner ;
- des champs peuvent être ajoutés de manière additive seulement si leur absence reste supportée par les consommateurs existants ;
- un champ existant ne doit pas être renommé ou supprimé ;
- le type ou la sémantique d'un champ existant ne doit pas être changé de manière incompatible ;
- une opération read-only ne doit pas devenir mutable ;
- les budgets documentés ne doivent pas être élargis silencieusement au point de casser les hypothèses de contexte.

Toute rupture nécessite une nouvelle version de schéma explicitement documentée et des tests de
compatibilité dédiés.

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

## État d'implémentation du candidat `1.1.0`

- `search_docs` est implémenté.
- `list_docs` et `read_doc_section` sont implémentés avec budgets de réponse fixes.
- Les resources catalogue/sources/documents/sections et les templates par identifiant sont implémentés.
- Les templates paginés sources/documents/versions/sections sont implémentés.
- Le benchmark de budget contexte couvre 100, 1 000 et 10 000 sections ; à 10 000 sections, la
  réduction de caractères est de 99,67 % face à la simulation globale historique.
- Les opérations mutables restent hors MCP.
- V2.14 ajoute un E2E STDIO de gel observant outils, annotations, resources, templates,
  `structuredContent`, `schemaVersion` et compatibilité V1.
- Le workflow candidat contient des triggers PR, mais aucun run attaché à sa tête actuelle ne vaut
  encore preuve. La restriction de facturation observée en juillet est un fait historique, pas un
  état courant présumé.

Les benchmarks et validations datés ci-dessus restent attachés à leurs SHA. Le verdict courant et
les preuves encore exigées sont centralisés dans
[`docs/status/current-state.md`](../status/current-state.md).

## Qualification client obligatoire V2.14

Le gel définitif ne repose pas uniquement sur les tests serveur.

### Client STDIO de référence

Doit prouver automatiquement :

1. `tools/list` avec les cinq outils ;
2. annotations et schémas ;
3. `resources/list` avec les quatre resources statiques ;
4. les neuf templates ;
5. lecture de `mcp-search-net://catalog` ;
6. `schemaVersion = "1.0"` et `EXTERNAL_UNTRUSTED_CONTENT` ;
7. compatibilité V1 ;
8. stdout réservé au JSON-RPC.

### IntelliJ IDEA + GitHub Copilot

La preuve doit relever la version du client/plugin et les capacités réellement observées. Un verdict
`PASS AVEC RÉSERVE` est acceptable si `search_docs` et `read_doc_section` fonctionnent mais que le
client n'expose pas directement resources/templates, à condition que le fallback soit documenté.

### Codex Desktop

Une preuve d'intégration native doit être distinguée d'un test effectué via un client STDIO explicite.
Un fallback STDIO ne peut pas être présenté comme preuve que Codex Desktop expose nativement le
serveur MCP. Si la capacité native n'est pas disponible dans la version testée, le verdict doit le dire
explicitement.

Le protocole de preuve est versionné dans :

```text
docs/planning/validation-v2-14-client-contracts.md
```

## Règles de compatibilité V1

- `search_web` reste exposé avec son nom et son contrat V1.
- `fetch_url` reste exposé avec son nom et son contrat V1.
- Les codes d'erreur V1 restent stables.
- Les annotations V1 restent read-only/idempotent/open-world.
- Le serveur peut exposer les capacités V2 sans retirer les capacités V1.
- Les tests V1 et V2 doivent passer sur le même SHA exact avant gel.

## Conséquences

### Positives

- Un seul outil principal pour la recherche documentaire, complété par deux lectures ciblées.
- Resources adaptées aux documents stables.
- Taille de réponse indépendante de la taille totale du catalogue pour les parcours paginés.
- Moins de surface d'action mutable exposée au LLM.
- Contrat agent explicite et mesurable.
- Politique de version de schéma documentée.

### Négatives

- Les clients MCP peuvent exposer des sous-ensembles différents des capabilities serveur.
- Documentation client plus riche à maintenir.
- Les recettes IntelliJ/Copilot et Codex Desktop restent manuelles.
- Toute évolution incompatible nécessite une nouvelle version de contrat.

## Critères d'acceptation avant gel définitif

- E2E STDIO tools/resources/templates vert sur le head exact final.
- `schemaVersion = "1.0"` et annotations observés par le client de référence.
- Budget de contexte confirmé sur 10 000 sections.
- Contrats V1 `search_web` et `fetch_url` non régressés.
- Recette IntelliJ/Copilot exécutée et archivée.
- Recette Codex Desktop exécutée ou capacité native honnêtement déclarée non disponible.
- Documentation utilisateur alignée sur les capacités réellement observées.
