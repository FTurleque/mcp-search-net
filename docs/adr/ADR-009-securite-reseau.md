# ADR-009 — Bloquer les réseaux privés et contrôler les redirections

- Statut : Accepté
- Date : 22 juin 2026

## Contexte

Une URL fournie par un agent est hostile et peut viser une ressource locale, privée ou une redirection trompeuse.

## Décision

Valider protocole, identifiants, port, nom et toutes les réponses DNS avant chaque connexion. Épingler l'adresse approuvée, revalider chaque redirection et borner taille, délai, concurrence et nombre de sauts.

## Conséquences

Certaines ressources légitimes non publiques sont refusées. Les tests de sécurité doivent prouver qu'aucune connexion n'atteint une cible bloquée.
