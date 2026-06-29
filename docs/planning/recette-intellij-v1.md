# Recette manuelle IntelliJ / GitHub Copilot — V1

Cette recette clôt AC-02. Elle doit être exécutée dans IntelliJ IDEA avec GitHub
Copilot connecté ; les tests STDIO automatisés ne remplacent pas cette preuve UI.

## Préconditions

- Node.js 24 actif et `npm run build` réussi ;
- SearXNG et Crawl4AI sains ;
- configuration MCP installée selon `docs/getting-started/intellij-copilot.md` ;
- fenêtre IntelliJ redémarrée après modification de la configuration MCP.

## Scénario

1. Ouvrir la fenêtre GitHub Copilot Chat et afficher les outils MCP disponibles.
2. Vérifier que le serveur `mcp-search-net` est connecté et n’expose que
   `search_web` et `fetch_url`.
3. Demander : « Recherche la documentation officielle Maven sur le cycle de vie ».
   Vérifier qu’une URL officielle, son statut et son score sont affichés.
4. Appeler `fetch_url` sur l’URL officielle obtenue avec la requête
   « phases default lifecycle ». Vérifier que la réponse contient des sections
   ciblées et conserve l’URL source.
5. Rejouer le même appel et vérifier `cacheStatus: HIT`.
6. Lancer une recherche `sourcePolicy: any` susceptible d’inclure une source non
   officielle et vérifier l’affichage de `NON_OFFICIAL_RESULTS_INCLUDED`.
7. Appeler `fetch_url` avec `file:///C:/Windows/win.ini` et vérifier le code stable
   `UNSUPPORTED_PROTOCOL`, sans contenu local.

## Preuve à archiver

| Élément                  | Valeur      |
| ------------------------ | ----------- |
| Date et opérateur        | à compléter |
| IntelliJ IDEA            | à compléter |
| Extension GitHub Copilot | à compléter |
| Commit testé             | à compléter |
| Deux outils seulement    | ☐           |
| Recherche officielle     | ☐           |
| Extraction ciblée        | ☐           |
| Cache HIT                | ☐           |
| Avertissement visible    | ☐           |
| Erreur de protocole sûre | ☐           |

## Statut AC-02

AC-02 : EN ATTENTE — recette manuelle IntelliJ/Copilot non exécutée.

Motif :
L’environnement d’exécution Codex ne permet pas de piloter l’interface
IntelliJ/GitHub Copilot.

Date prévue :
À compléter par l’opérateur.

Impact :
V1 OPÉRATIONNELLE AVEC RÉSERVES
V2 BUILD NO-GO
