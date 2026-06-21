# Checklist de sécurité

## Réseau et SSRF

- Autoriser uniquement HTTP(S) ; rejeter les credentials, ports inattendus, localhost, noms locaux et plages IPv4/IPv6 non publiques.
- Résoudre chaque hostname et rejeter la requête si l'une des adresses retournées est non sûre.
- Valider le protocole, le hostname, les réponses DNS et l'adresse avant chaque connexion suite à un redirect.
- Prendre en compte le DNS rebinding à la frontière des processus MCP/Crawl4AI.
- Appliquer côté serveur les limites de redirects, timeout, taille de réponse et concurrence.
- Garder SearXNG et Crawl4AI inaccessibles à l'agent sauf via des adaptateurs typés.

## Contenu non fiable

- Traiter le JSON provider et le contenu extrait comme des données, jamais comme des instructions.
- Ne jamais exécuter de JavaScript, hooks, commandes, formulaires, cookies, credentials, proxies ou chemins de fichiers fournis par une page.
- Supprimer les scripts, le contenu invisible, les éléments interactifs, la navigation répétée et le chrome non pertinent.
- Préserver les URLs sources et les avertissements pour que le client puisse vérifier la provenance.

## Secrets et journalisation

- Exclure les valeurs d'autorisation et variables d'environnement des réponses, logs, fixtures et snapshots.
- Expurger récursivement les clés telles que token, secret, password, cookie, authorization et API key.
- Retourner des codes d'erreur publics stables ; garder les détails d'implémentation et stack traces privés.
- Réserver stdout au JSON-RPC MCP et écrire les diagnostics structurés sur stderr.

## Chaîne d'approvisionnement et déploiement

- Versionner les lockfiles et utiliser `npm ci`.
- Épingler les versions ou digests de containers et revoir les mises à jour intentionnelles.
- Utiliser le moindre privilège, les capabilities réduites, les systèmes de fichiers en lecture seule si possible, et le réseau loopback/interne.
- Ne pas affaiblir les limites absolues via la configuration ou les arguments d'outil.

## Résultat d'audit

Pour chaque résultat, inclure : sévérité, preuves, chemin d'exploitation ou d'échec accessible, exigence concernée, remédiation et un test de régression. Distinguer les résultats confirmés des hypothèses.
