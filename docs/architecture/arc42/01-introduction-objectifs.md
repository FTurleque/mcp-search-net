# Section 1 — Introduction et objectifs

> arc42 · mcp-search-net v1.1.0 · 2026-08-08

---

## 1.1 Résumé du système

`mcp-search-net` est un **serveur MCP local, en lecture seule**, conçu pour être lancé comme processus enfant par un assistant de codage IA (GitHub Copilot dans IntelliJ IDEA, Claude Code, Codex Desktop, Copilot CLI). Il expose cinq outils MCP via le protocole JSON-RPC sur `stdin`/`stdout` (transport STDIO) :

| Outil | Périmètre | Source |
|---|---|---|
| `search_web` | Découvre des URLs sur le Web public | SearXNG (local) |
| `fetch_url` | Extrait le contenu Markdown d'une URL publique | Crawl4AI + passerelle HTTP |
| `search_docs` | Recherche dans le catalogue documentaire local | SQLite FTS5/BM25 |
| `list_docs` | Parcourt les métadonnées du catalogue | SQLite |
| `read_doc_section` | Lit une section documentaire par identifiant | SQLite |

Le serveur n'embarque **aucun LLM** et ne requiert **aucune API commerciale**. Tout le traitement est local, déterministe et reproductible.

---

## 1.2 Objectifs métier

| # | Objectif | Justification |
|---|---|---|
| M1 | Fournir au LLM client une capacité de recherche Web locale et hors quota IA | Indépendance vis-à-vis des APIs tierces et des quotas |
| M2 | Garantir la sécurité de chaque URL traitée (protection SSRF) | Confiance zéro envers les URLs fournies par un agent LLM |
| M3 | Offrir une base documentaire locale interrogeable sans réseau | Fonctionnement hors ligne, recherche reproductible |
| M4 | Permettre l'installation sur poste développeur Windows sans droits admin supplémentaires | Adoption facile dans un contexte entreprise |

---

## 1.3 Parties prenantes

| Partie prenante | Intérêt | Attente principale |
|---|---|---|
| **Développeur** (utilisateur final) | Disposer d'un serveur MCP fiable dans son IDE | Résultats pertinents, pas de fuite de données locales |
| **Agent LLM** (Copilot, Claude, Codex) | Appeler les outils MCP pour enrichir son contexte | Réponses structurées, codes d'erreur stables, latence faible |
| **Auteur** (Fabrice Turleque) | Maintenir et faire évoluer le serveur | Architecture testable, dette technique contrôlée |
| **CI/CD** | Vérifier la non-régression à chaque commit | Suite de tests complète, `npm run check` en vert |
| **Opérateur Docker** | Déployer les fournisseurs dans un réseau isolé | Images figées par digest, moindre privilège |

---

## 1.4 Objectifs qualité priorisés

Les scénarios détaillés sont dans [`10-exigences-qualite.md`](10-exigences-qualite.md).

| Priorité | Attribut | Seuil / Énoncé |
|---|---|---|
| 1 | **Sécurité** | Aucune URL menant à un réseau privé ne franchit la passerelle HTTP ; vérification après chaque redirection |
| 2 | **Fiabilité** | En cas d'indisponibilité de SearXNG, la réponse stale est retournée si disponible ; sans cache, l'erreur est mappée sur un code stable |
| 3 | **Maintenabilité** | Les couches `domain` et `application` ont zéro dépendance vers `infrastructure` ou le SDK MCP ; vérifié par grep CI |
| 4 | **Performance** | p95 FTS5/BM25 ≤ 150 ms à 10 000 sections (mesuré à 17,3 ms, benchmark V2.13) |
| 5 | **Portabilité** | Le serveur s'installe depuis les sources (Node.js + npm) ou via un ZIP Windows embarquant Node.js, sans modificaton d'un registry système |
