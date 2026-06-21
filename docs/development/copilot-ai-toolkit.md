# Boîte à outils IA Copilot

Le dépôt embarque une configuration Copilot destinée à la maintenance quotidienne, aux audits, aux corrections, aux fonctionnalités, à la sécurité et aux préparations de release.

## Agents spécialisés

Les profils se trouvent dans `.github/agents`.

| Agent                | Usage                                                                  |
| -------------------- | ---------------------------------------------------------------------- |
| `project-maintainer` | Maintenance générale, roadmap, refactorisation et orchestration        |
| `feature-engineer`   | Nouvelle fonctionnalité complète avec contrats, tests et documentation |
| `bug-fixer`          | Reproduction, diagnostic, correction minimale et test de régression    |
| `security-auditor`   | Audit de sécurité strictement en lecture seule                         |
| `release-guardian`   | Décision GO/NO-GO et vérification des preuves de livraison             |

Sélectionner l'agent dans l'interface Copilot lorsqu'elle prend en charge les agents personnalisés. Les profils sans droit d'édition sont volontairement limités aux outils de lecture, recherche et exécution non mutante.

## Prompts prêts à l'emploi

Les fichiers `.github/prompts/*.prompt.md` couvrent :

- audit général ;
- correction de bug ;
- ajout de fonctionnalité ;
- audit de sécurité ;
- préparation de release ;
- poursuite de la roadmap ;
- revue des dépendances et images.

Les lancer depuis le sélecteur de prompt de Copilot ou ouvrir le fichier correspondant selon l'IDE. Les interfaces et certains champs de frontmatter peuvent varier entre GitHub, Copilot CLI et les IDE ; le corps du prompt reste autonome.

## Front matter enrichi

Les fichiers de configuration IA suivent un front matter enrichi pour faciliter la gouvernance et la validation automatique. Les champs `owner`, `version` et `lastReviewed` sont obligatoires pour les agents, prompts, instructions et skills.

Exemple agent (`.github/agents/*.agent.md`) :

```yaml
---
name: MCP Feature Engineer
description: Designs and implements new mcp-search-net features with architecture, contract, security, tests, and documentation kept aligned.
owner: mcp-search-net
version: 1.0.0
lastReviewed: '2026-06-21'
tools: [read, search, edit, execute]
---
```

Exemple prompt (`.github/prompts/*.prompt.md`) :

```yaml
---
name: Fix Bug
description: Reproduce and fix a defect with root-cause analysis and regression tests.
agent: bug-fixer
owner: mcp-search-net
version: 1.0.0
lastReviewed: '2026-06-21'
---
```

Exemple instruction (`.github/instructions/*.instructions.md`) :

```yaml
---
name: Documentation
description: Documentation writing and organization conventions in French.
applyTo: 'docs/**/*.md,README.md'
owner: mcp-search-net
version: 1.0.0
lastReviewed: '2026-06-21'
---
```

Exemple skill (`.github/skills/**/SKILL.md`) :

```yaml
---
name: maintain-mcp-search-net
description: Maintain, audit, debug, secure, test, document, and evolve the mcp-search-net TypeScript MCP server.
owner: mcp-search-net
version: 1.0.0
lastReviewed: '2026-06-21'
---
```

## Skill projet

Le skill `.github/skills/maintain-mcp-search-net/SKILL.md` centralise le workflow de maintenance. Copilot peut le charger automatiquement lorsque la demande correspond à sa description. Il peut aussi être demandé explicitement :

> Utilise le skill `maintain-mcp-search-net` pour auditer le cache et proposer une correction.

Le skill charge progressivement :

- `references/project-map.md` pour l'architecture, les commandes et les frontières stables ;
- `references/security-checklist.md` pour les travaux réseau, fournisseur, cache, Docker, secrets ou journalisation ;
- `scripts/project-snapshot.mjs` pour un état synthétique et non destructif du dépôt.

## Instructions automatiques

`.github/copilot-instructions.md` définit les règles globales. Les fichiers `.github/instructions` ajoutent des contraintes ciblées pour :

- l'architecture TypeScript ;
- les tests ;
- les chemins réseau et sécurité ;
- la documentation ;
- Docker, configuration, installation et CI.

Copilot combine les instructions applicables au fichier en cours. Éviter de dupliquer ces règles dans les prompts ponctuels.

## Hooks de sécurité

`.github/hooks/project-guardrails.json` configure trois événements :

1. `sessionStart` injecte le contexte et les invariants du projet ;
2. `preToolUse` refuse les commandes destructrices courantes (`git reset --hard`, nettoyage forcé, force-push, suppression récursive forcée, publication, destruction d'infrastructure, etc.) ;
3. `postToolUse` rappelle les validations lorsqu'un fichier de sécurité, déploiement, configuration, installation ou dépendances est modifié.

Ce fonctionnement suit une approche Option B (équilibrée) :

- blocage strict des commandes destructrices connues dans `preToolUse` ;
- rappel contextuel non bloquant dans `postToolUse`, avec actions concrètes (front matter, `applyTo`, tests hostiles, vérification des secrets, et commande de check).

Les scripts sont en JavaScript standard et les hooks déclarent les commandes `bash` et `powershell`. D'après la référence GitHub, les hooks de dépôt `.github/hooks/*.json` s'appliquent à Copilot CLI et au cloud agent ; un IDE qui ne prend pas encore en charge les hooks les ignore.

Pour désactiver temporairement ce fichier sans le supprimer :

```json
{
  "version": 1,
  "disableAllHooks": true,
  "hooks": {}
}
```

Le hook `preToolUse` est volontairement fail-closed : une entrée invalide produit un refus plutôt qu'une autorisation silencieuse.

## Vérifier la configuration

```powershell
node .github/skills/maintain-mcp-search-net/scripts/project-snapshot.mjs
npm run check:copilot
npm run check
```

Le validateur `check:copilot` contrôle notamment :

- la présence du front matter YAML ;
- les champs enrichis requis (`owner`, `version`, `lastReviewed`) ;
- le format SemVer de `version` ;
- le format de date `YYYY-MM-DD` de `lastReviewed` ;
- la cohérence `agent` des prompts et l'intégrité JSON des hooks.

Les fichiers JSON des hooks, les frontmatters et les scripts doivent également être validés après toute modification de cette boîte à outils.
