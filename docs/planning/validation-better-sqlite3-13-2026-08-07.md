# Validation #51 — migration `better-sqlite3` 13 / N-API

Date : 2026-08-07

## Objet

La migration remplace `better-sqlite3@12.11.1` par `better-sqlite3@13.0.3` et retire la dépendance
transitive dépréciée `prebuild-install@7.1.3`.

La série 13 passe à N-API et publie ses prebuilds avec le package. La tarball conserve un lifecycle
`install` de repli vers `node-gyp rebuild`; pour les plateformes supportées par ce produit, ce
fallback est explicitement refusé avec `allowScripts["better-sqlite3@13.0.3"] = false`. La
qualification doit donc démontrer que Linux, Docker et Windows fonctionnent avec les prebuilds
embarqués sans compilation native opportuniste.

## Graphe supply-chain attendu

- `better-sqlite3` : exactement `13.0.3` ;
- `node-addon-api` : présent ;
- `prebuild-install` : absent ;
- `bindings` : absent ;
- fallback `node-gyp rebuild` : explicitement refusé ;
- `npm audit` complet : PASS ;
- `npm audit --omit=dev` : PASS.

`scripts/check-supply-chain.mjs` et `scripts/check-audit-invariants.mjs` gèlent ces règles.

## Compatibilité SQLite à prouver

Le passage de 12.11.1 à 13.0.3 inclut une mise à jour du moteur SQLite. Le produit dépend de
fonctionnalités qui doivent rester stables : migrations SQL, FTS5, transactions atomiques, cache,
backup, restauration par snapshot et verrouillage multi-connexion.

Preuves déterministes :

- `tests/infrastructure/better-sqlite3-13-qualification.test.ts` : version SQLite minimale 3.53.4,
  création/requête FTS5 et verrouillage de writer entre deux connexions ;
- `tests/infrastructure/catalog-migration-runner.test.ts` : migrations ordonnées et invariants de
  migration ;
- `tests/infrastructure/sqlite-catalog-repository.test.ts` : catalogue, transactions, FTS et
  persistance ;
- `tests/infrastructure/sqlite-cache-repository.test.ts` : cache SQLite ;
- `tests/infrastructure/sqlite-catalog-backup.test.ts` : backup SQLite vérifié ;
- `tests/integration/catalog-operations-cli.test.ts` : health, backup, corruption simulée,
  restauration du snapshot puis health valide.

## Gates exact-head

Le merge de #51 est autorisé uniquement lorsque le SHA exact final de la PR a réussi :

1. `Node.js 24 validation` ;
2. `Docker integration and live E2E` ;
3. `Windows installation and STDIO packaging` ;
4. les deux audits npm ;
5. le Quality Gate SonarQube ;
6. l'absence de `prebuild-install` dans le lock et les vérifications supply-chain ;
7. l'absence du workflow bootstrap temporaire utilisé pour produire le lock initial.

Un run d'un SHA antérieur reste une preuve de diagnostic, jamais une qualification du candidat
final.
