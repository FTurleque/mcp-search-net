# Supply chain et mises à jour

## Gates locaux

Le contrôle déterministe, sans réseau, fait partie de `npm run check` :

```bash
npm run check:supply-chain
```

Il vérifie les versions exactes du SDK MCP et des overrides de sécurité, les
quatre références OCI par digest, l'absence de secret Compose par défaut et les licences des
paquets de production réellement installés. Une dépendance de production sans
manifeste ou avec une licence hors liste autorisée fait échouer le gate.

La qualification avec accès au registre ajoute :

```bash
npm audit --audit-level=moderate
npm audit --omit=dev --audit-level=moderate
```

Les deux commandes doivent annoncer zéro vulnérabilité connue. Ne pas utiliser
`npm audit fix` ou `--force` sans avoir identifié chaque chemin de dépendance et
validé les changements de version.

## Installation de production reproductible

Valider dans un répertoire propre, sans réutiliser `node_modules` :

```bash
npm ci --omit=dev
npm audit --omit=dev --audit-level=moderate
```

Le lockfile est la source de vérité. La recette Windows exécute cette installation
dans le staging et a confirmé 132 paquets installés, puis zéro vulnérabilité de
production lors de la qualification V2.12.

## Mise à jour npm

1. lire le chemin exact avec `npm explain <package>` ;
2. consulter la version corrigée publiée et ses `peerDependencies` ;
3. préférer la mise à jour directe cohérente ; utiliser un override exact
   seulement lorsqu'il reste compatible avec le parent ;
4. régénérer le lockfile dans un arbre propre si un module natif est chargé ;
5. exécuter audit complet, supply-chain, lint, typecheck et tests.

Les overrides actuels corrigent les transitives du SDK MCP et de la chaîne de
développement. ESLint, `@eslint/js` et typescript-eslint sont maintenus comme un
triplet compatible.

## Mise à jour des images OCI

Les références immuables se trouvent dans `Dockerfile` et `compose.yaml`.

1. relever le digest multiarchitecture officiel du tag voulu ;
2. vérifier qu'il contient les plateformes de qualification, au minimum
   `linux/amd64` et la plateforme locale requise ;
3. remplacer tag et digest ensemble ;
4. exécuter `npm run check:supply-chain` ;
5. construire l'image MCP sans cache implicite, inspecter l'image résolue, puis
   exécuter les tests Docker/live ;
6. archiver versions, digests et résultats dans la preuve de qualification.

Ne jamais convertir un digest en simple tag pour rendre un build vert. Ne jamais
démarrer, arrêter ou supprimer les ressources Docker existantes sans vérifier
leur identité et sans autorisation adaptée.
