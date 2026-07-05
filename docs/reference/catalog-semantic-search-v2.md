# Recherche sémantique V2.7

## Statut

La V2.7 ajoute un prototype local de recherche hybride.

Le prototype ne dépend d'aucune API externe, d'aucun modèle téléchargé et d'aucun service payant.

## Principe

La recherche hybride conserve la recherche lexicale comme socle. Elle récupère d'abord des candidats via le catalogue existant, puis applique un score local déterministe sur le texte des sections.

Le score final combine :

- score lexical normalisé ;
- score local de similarité ;
- pondération hybride stable.

## Commande

```bash
npm run catalog:hybrid-search -- --path .data/catalog.db --query "texte recherché"
```

Options principales :

```text
--query <text>
--path <catalog.db>
--source-key <key>
--language <language>
--limit <n>
--candidate-limit <n>
```

## Contrat

La sortie JSON indique :

- `schemaVersion` ;
- `query` ;
- `strategy` ;
- `resultCount` ;
- `lexicalScore` ;
- `semanticScore` ;
- `hybridScore`.

## Limites volontaires

- Pas d'embeddings payants.
- Pas de stockage vectoriel durable.
- Pas de mutation du catalogue.
- Pas d'exposition MCP mutable.
- La recherche lexicale reste la référence tant que le benchmark ne prouve pas un gain net.
