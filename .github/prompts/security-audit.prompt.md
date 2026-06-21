---
name: Security Audit
description: >
  Audit de sécurité lecture seule de mcp-search-net : SSRF, DNS rebinding,
  redirects, budgets de contenu, isolation Crawl4AI, injection de prompt,
  cache, logging, Docker, dépendances et secrets.
mode: agent
agent: security-auditor
tools:
  - codebase
  - runCommands
  - fetch
  - problems
owner: mcp-search-net
version: 1.1.0
lastReviewed: '2026-06-21'
---

# Audit de sécurité — mcp-search-net

## Périmètre d'audit

> **Indique** le domaine prioritaire ou laisse vide pour un audit complet :
> - [ ] SSRF et validation URL (`src/infrastructure/security/`)
> - [ ] Budgets et limites (taille, timeout, redirects, concurrence)
> - [ ] Isolation Crawl4AI (`src/infrastructure/fetch/`)
> - [ ] Injection de prompt et contenu hostile
> - [ ] Cache SQLite (`src/infrastructure/cache/`)
> - [ ] Logging et error disclosure (`src/infrastructure/logging/`)
> - [ ] Docker et déploiement (`Dockerfile`, `compose.yaml`)
> - [ ] Dépendances et CI (`package.json`, `.github/workflows/`)
> - [ ] Secrets et configuration (`config/`, scripts)

## Ce que l'agent doit faire

1. **Lire** `.github/skills/maintain-mcp-search-net/references/security-checklist.md` et `docs/reference/security.md`.
2. **Analyser** le code et la configuration dans le périmètre demandé.
3. **Documenter** chaque finding avec : fichier:ligne, scénario d'exploitation, impact, test manquant, remédiation.
4. **Ne pas modifier** de fichier, installer de paquet, démarrer de service, ni contacter de cible externe.
5. **Lister** les incertitudes résiduelles (code conditionnel non atteignable, tests live non exécutés).

## Format de sortie attendu

```
## Résumé : X critiques, Y élevés, Z moyens, W faibles

### [CRITIQUE] Titre
Fichier : src/...
Scénario : ...
Impact : ...
Test manquant : ...
Remédiation : ...

## Incertitudes résiduelles
...
```

## Règle absolue

L'agent ne doit jamais implémenter des corrections dans cette session. Si des corrections sont souhaitées, utilise le prompt `fix-bug` ou `add-feature` dans une session dédiée.
