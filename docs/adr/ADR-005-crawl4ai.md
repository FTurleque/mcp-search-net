# ADR-005 — Utiliser Crawl4AI pour l'extraction

- Statut : Accepté
- Date : 22 juin 2026

## Contexte

Les pages dynamiques nécessitent parfois un rendu que l'extraction statique locale ne fournit pas.

## Décision

Conserver Crawl4AI comme rendu de secours du port `ContentFetcher`. La cible publique est d'abord téléchargée par la passerelle sécurisée ; Crawl4AI reçoit uniquement un document `raw://` neutralisé, transport natif qui ne déclenche aucune requête réseau.

## Conséquences

La protection SSRF ne dépend pas du navigateur. Le mode statique reste prioritaire et aucun JavaScript, hook, cookie, proxy ou identifiant fourni par l'appelant n'est accepté.
