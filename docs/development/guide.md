# Développement

## Environnement

Le projet cible Node.js 24 LTS, npm et TypeScript strict. L’installateur utilisateur embarque son propre Node.js ; pour travailler directement dans le dépôt, utiliser également Node 24.

```powershell
npm ci
npm run check
docker compose -f compose.yaml -f compose.hybrid.yaml up -d
npm run dev
```

`npm run dev` lance TypeScript avec `tsx`. `npm run build` nettoie puis produit `build`, et `npm start` lance cette version compilée.

## Règles de conception

- conserver le domaine indépendant des adaptateurs ;
- exposer exactement `search_web` et `fetch_url` en V1 ;
- conserver tous les logs sur `stderr` ;
- considérer URLs et contenu Web comme non fiables ;
- ne jamais transmettre à Crawl4AI une configuration exécutable fournie par l’appelant ;
- préserver la séparation entre outils Web V1, catalogue documentaire V2 et opérations mutables CLI ;

## Cycle de modification

1. Ajouter ou adapter les tests au niveau le plus bas pertinent.
2. Implémenter derrière un port lorsqu’une dépendance externe est impliquée.
3. Exécuter `npm run check`.
4. Tester les intégrations réelles avec Docker lorsque l’adaptateur change.
5. Relancer `scripts\install-user.ps1 -StartServices` pour valider le paquet utilisateur.

Ne modifier jamais directement le contenu de `%LOCALAPPDATA%\mcp-search-net\app` : il est remplacé à chaque installation. Les fichiers `config` et `data` sont persistants.

## Scripts npm

| Commande                | Rôle                       |
| ----------------------- | -------------------------- |
| `npm run check:runtime` | vérification de Node 24    |
| `npm run dev`           | serveur depuis les sources |
| `npm run build`         | compilation de production  |
| `npm start`             | serveur compilé            |
| `npm run typecheck`     | vérification TypeScript    |
| `npm run lint`          | ESLint                     |
| `npm run format`        | écriture Prettier          |
| `npm run format:check`  | contrôle Prettier          |
| `npm test`              | suite Vitest               |
| `npm run test:coverage` | tests et seuils coverage   |
| `npm run check`         | validation complète        |
