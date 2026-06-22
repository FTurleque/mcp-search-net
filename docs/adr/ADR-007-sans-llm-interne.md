# ADR-007 — Ne pas utiliser de LLM interne

- Statut : Accepté
- Date : 22 juin 2026

## Contexte

La réduction de contexte doit être reproductible, locale, économique et indépendante d'un quota IA.

## Décision

Utiliser des règles déterministes et BM25 local pour classer les résultats et sections. Aucun SDK ou appel LLM n'est autorisé dans le serveur.

## Conséquences

Les scores restent explicables et bornés, sans prétendre mesurer la vérité. La sélection sémantique avancée reste hors V1.
