# Tests

## Validation complète

```powershell
npm run check
```

Cette commande enchaîne typecheck, ESLint, contrôle Prettier, compilation et Vitest. Elle doit réussir avant une installation ou une contribution.

Elle commence par `npm run check:runtime` et s'arrête immédiatement avec un message explicite si le runtime actif n'est pas Node.js 24. La CI exécute `npm ci` puis cette même commande sous Node 24.

## Niveaux

- domaine : classement officiel, sélection Markdown et budgets ;
- application : cas d’usage avec ports simulés, cache et erreurs ;
- infrastructure : YAML/Zod, SQLite, politique DNS/URL et clients HTTP simulés ;
- présentation : schémas MCP, résultats structurés et erreurs ;
- intégration : SearXNG et Crawl4AI réels via Docker ;
- bout en bout : client MCP STDIO lançant le serveur compilé.

Les tests réseau réels doivent être explicitement activés afin que la suite ordinaire reste déterministe. Vérifier aussi qu’aucun log applicatif n’est écrit sur `stdout`.

## Installation Windows

Après `npm run check`, lancer la configuration IntelliJ `MCP - Install user (Windows)`, vérifier `%LOCALAPPDATA%\mcp-search-net\VERSION`, puis contrôler les conteneurs et les deux outils dans Copilot. Une seconde installation doit conserver un changement manuel fait dans `config\application.yml`.
