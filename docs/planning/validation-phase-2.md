# Rapport de validation — Phase 2

Date : 21 juin 2026

## Résultat

La Phase 2 `search_web` est terminée. La validation complète sous Node.js 24.17.0 produit :

- 13 fichiers de tests réussis ;
- 67 tests déterministes réussis ;
- 2 suites réseau ignorées par défaut ;
- 1 test SearXNG réel réussi séparément avec `RUN_LIVE_SEARXNG=1`.

## Contrat validé

- `sourcePolicy: strict | prefer | any`, défaut `prefer` ;
- `allowedDomains` et `excludedDomains`, 20 maximum, avec comparaison par frontière DNS ;
- `language: fr-FR` par défaut et repli anglais si la première recherche ne retourne rien ;
- périodes `day`, `week`, `month`, `year` ;
- requêtes de 2 à 500 caractères sans caractère de contrôle ;
- 5 résultats par défaut et maximum absolu de 10.

## Traitement validé

- normalisation de tous les champs avant la clé de cache ;
- clés distinctes pour chaque paramètre influent, le registre, le suréchantillonnage et la taille des extraits ;
- suppression des fragments et paramètres de suivi connus ;
- conservation et tri des paramètres fonctionnels ;
- normalisation du port implicite et du slash final ;
- déduplication canonique ;
- statuts `VERIFIED_OFFICIAL`, `LIKELY_OFFICIAL`, `THIRD_PARTY`, `UNKNOWN` ;
- score déterministe borné entre 0 et 1 ;
- ordre stable par score, titre et URL ;
- avertissements `NO_RESULTS`, `NO_VERIFIED_OFFICIAL_SOURCE`, `NON_OFFICIAL_RESULTS_INCLUDED`, `RESULTS_TRUNCATED` et `FALLBACK_LANGUAGE_USED`.

## Registre officiel

Le registre contient désormais les sources du benchmark : JetBrains, OpenJDK, Maven, Quarkus, OpenJFX, Oracle, Sonar et Docker, en plus des sources déjà présentes. Les organisations GitHub déclarées sont comparées uniquement sur `github.com` et sur un segment d'organisation complet.

## Test réel

Le test MCP STDIO réel a exécuté `search_web` avec :

- `sourcePolicy: strict` ;
- `allowedDomains: [modelcontextprotocol.io]` ;
- cinq résultats maximum.

Il vérifie une réponse non vide, des URL HTTP(S), des sources exclusivement `VERIFIED_OFFICIAL` et des scores compris entre 0 et 1.

`search_web` dépend uniquement du port `SearchProvider`, du cache et du registre officiel : aucune page trouvée n'est récupérée automatiquement.
