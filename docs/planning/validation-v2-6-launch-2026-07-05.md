# Lancement V2.6 — Automatisation contrôlée — 2026-07-05

## Statut

- **Branche** : `feat/v2-catalog-storage`.
- **PR** : #8, conservée en draft.
- **GitHub Actions** : non déclenchées.
- **Merge** : non effectué.
- **Ready for Review** : non effectué.
- **Décision** : V2.6 lancée côté code, validation locale partielle effectuée.

## Objectif

La V2.6 ajoute une exploitation contrôlée du catalogue local sans exposer d'opération mutable au LLM via MCP.

Le modèle retenu est un cycle court, idempotent et planifiable par un ordonnanceur externe, plutôt qu'un service interne permanent.

## Livré dans cette tranche

- Point d'entrée npm `catalog:maintain`.
- CLI `src/cli/catalog-maintain.ts`.
- Use-case `MaintainCatalog`.
- Runner SQLite `SqliteCatalogMaintenance`.
- Exclusion mutuelle par fichier de verrouillage.
- Rétention opérationnelle sur `sync_runs`.
- Maintenance SQLite : migrations idempotentes, optimize, analyse, checkpoint WAL et vacuum optionnel.
- Événements structurés de début, succès, échec et verrou obsolète.
- Test applicatif du use-case.
- Documentation de référence `docs/reference/catalog-operations-v2.md`.

## Validation locale exécutée

Résultat avant correction du lint :

```text
git pull: Already up to date
format:check: OK
lint: KO, @typescript-eslint/require-await sur SqliteCatalogMaintenance.run
typecheck: OK
build: OK
test: OK, 35 fichiers de tests passés, 180 tests passés
catalog:maintain: OK sur .data/catalog-spike.db
```

Résultat du cycle de maintenance :

```text
catalog_maintenance_started: émis sur stderr
catalog_maintenance_completed: émis sur stderr
status: maintained
lock.acquired: true
retention.syncRunsBefore: 0
retention.syncRunsDeleted: 0
retention.syncRunsAfter: 0
sqlite.analyzed: true
sqlite.optimized: true
sqlite.walCheckpointed: true
sqlite.vacuumed: false
durationMs: 11
```

Correctif appliqué après validation locale :

- `SqliteCatalogMaintenance.run` ne déclare plus `async`.
- La méthode retourne explicitement une `Promise`.
- Objectif : satisfaire `@typescript-eslint/require-await` sans changer le contrat `CatalogMaintenanceRunner`.

## Validation à refaire après correctif lint

- Relancer `npm run lint`.
- Relancer `npm run typecheck`.
- Relancer `npm run build`.
- Relancer `npm run test`.
- Relancer `npm run catalog:maintain -- --path .data/catalog-spike.db`.

## Réserves

- Aucun workflow GitHub Actions n'a été lancé.
- La CI complète reste à rejouer manuellement après reset du quota Actions.
- La dette de formatage V2 reste à traiter progressivement.

## Conclusion

La V2.6 est lancée côté code sur les axes prévus : ordonnanceur externe, verrouillage inter-processus, observabilité structurée, rétention opérationnelle et maintenance SQLite.

La validation locale confirme déjà format, typecheck, build, tests et exécution du cycle de maintenance. Le seul échec constaté était un lint `require-await`, corrigé côté branche.
