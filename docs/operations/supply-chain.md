# Supply chain et mises à jour

## Gates locaux

Le contrôle déterministe, sans réseau, fait partie de `npm run check` :

```bash
npm run check:supply-chain
```

Il vérifie les versions exactes du SDK MCP et des overrides de sécurité, les références OCI par
digest, l'absence de secret Compose par défaut, la politique des scripts lifecycle npm, le pinning
de la toolchain Windows et les licences des paquets de production réellement installés. Une
dépendance de production sans manifeste ou avec une licence hors liste autorisée fait échouer le
gate.

La qualification avec accès au registre ajoute :

```bash
npm audit --audit-level=moderate
npm audit --omit=dev --audit-level=moderate
```

Les deux commandes doivent annoncer zéro vulnérabilité connue. Ne pas utiliser
`npm audit fix` ou `--force` sans avoir identifié chaque chemin de dépendance et
validé les changements de version.

## Scripts lifecycle npm dans les artefacts

`.npmrc` active `strict-allow-scripts=true` et `package.json` contient l'allowlist exacte des scripts
lifecycle autorisés. Cette frontière doit rester identique dans tous les environnements qui exécutent
`npm ci` :

- les deux stages du `Dockerfile` copient `.npmrc` avant l'installation ;
- le staging de la distribution Windows copie `.npmrc` avant `npm ci --omit=dev` ;
- `npm run check:supply-chain` vérifie explicitement ces deux invariants.

Une construction d'artefact qui omet `.npmrc` est considérée non qualifiée même si le checkout local
possède une politique stricte.

## Toolchain Windows immuable

Le workflow de release Windows n'utilise pas Chocolatey pour installer Inno Setup. La version
`6.7.1` est téléchargée directement depuis le serveur de fichiers officiel JRSoftware :

```text
https://files.jrsoftware.org/is/6/innosetup-6.7.1.exe
```

Le SHA-256 attendu, stocké dans le dépôt, est :

```text
4D11E8050B6185E0D49BD9E8CC661A7A59F44959A621D31D11033124C4E8A7B0
```

`scripts/windows/verify-file-sha256.ps1` vérifie ce digest avant toute exécution de l'installeur.
`npm run check:supply-chain`, `npm run check:audit-invariants` et les tests de sécurité imposent la
version, l'URL, le SHA-256 et l'ordre vérification puis exécution. Une mise à jour d'Inno Setup doit
modifier ces quatre preuves ensemble après vérification indépendante du nouveau binaire.

## Installation de production reproductible

Valider dans un répertoire propre, sans réutiliser `node_modules` :

```bash
npm ci --omit=dev
npm audit --omit=dev --audit-level=moderate
```

Le lockfile est la source de vérité. La recette Windows exécute cette installation
dans le staging et a confirmé 132 paquets installés, puis zéro vulnérabilité de
production lors de la qualification V2.12. Toute nouvelle release doit toutefois refaire ses audits
sur son SHA exact ; une preuve historique ne qualifie pas le candidat courant.

## Provenance historique de `v1.1.1`

Le tag Git historique `v1.1.1` pointe vers un commit dont `package.json` déclare encore la version
`1.1.0`. Il est conservé comme trace historique et ne constitue pas une release SemVer qualifiée
selon la politique actuelle. Le tag ne doit pas être réécrit silencieusement.

Toute future publication doit utiliser une nouvelle version dont le tag, le paramètre du workflow,
`package.json`, `package-lock.json` et les manifestes embarqués sont cohérents.

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
