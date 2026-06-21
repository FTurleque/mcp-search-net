# Rapport de validation — Phases 0 et 1

Date : 21 juin 2026

## Environnement

- Windows et PowerShell ;
- Node.js 24.17.0 utilisé depuis un runtime temporaire isolé ;
- npm 11.13.0 ;
- installation reproductible par `npm ci` ;
- image SearXNG épinglée sur le digest `sha256:d0f6ccf9d3faab5bba07bb6bbeb533c47dd4ace648ed5a0f8830e10eb96b7082` (`2026.6.20-fd42d4fda`).

## Validation déterministe

Commande exécutée :

```powershell
npm run check
```

Résultat :

- précontrôle Node 24 réussi ;
- typecheck réussi ;
- ESLint réussi ;
- contrôle Prettier réussi ;
- compilation de production réussie ;
- 51 tests réussis lors du passage final des phases 0 et 1 ;
- 2 tests réseau (SearXNG et Crawl4AI) ignorés conformément à leur activation explicite.

Le précontrôle a aussi été exécuté avec Node.js 18.16.1 : il s'arrête avant le typecheck avec le message attendu demandant explicitement Node 24.

## Validation SearXNG

- conteneur recréé avec le digest épinglé ;
- healthcheck Docker : `healthy` ;
- requête directe JSON : `model context protocol` ;
- 32 résultats retournés ;
- première URL observée : `https://modelcontextprotocol.io/docs/getting-started/intro`.

Le test `RUN_LIVE_SEARXNG=1` a ensuite appelé `search_web` à travers la pile complète MCP STDIO → cas d'usage → SearXNG. Il réussit et vérifie l'enveloppe commune, le `requestId`, le fournisseur, le statut de cache et la présence de résultats HTTP(S).

Ce test a permis de corriger un cas réel absent des premières fixtures : SearXNG peut retourner `publishedDate: null`. Les erreurs de contrat fournisseur ont également été rendues génériques côté client, leur détail restant uniquement dans la cause journalisée.

## Contrat MCP vérifié

- enveloppe commune `schemaVersion: "1.0"` ;
- `requestId` propagé à la réponse, aux avertissements, aux erreurs et aux logs ;
- durée monotone ;
- statuts `HIT`, `MISS`, `STALE_FALLBACK`, `DISABLED` ;
- avertissements et erreurs V1 déclarés et validés par schéma ;
- succès, succès partiel, erreur attendue et erreur interne couverts ;
- erreur d'entrée Zod convertie en `INVALID_ARGUMENT` lors d'un appel MCP STDIO réel ;
- repli textuel compact distinct de `structuredContent`.
