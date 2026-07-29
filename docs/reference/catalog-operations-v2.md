# Exploitation catalogue V2.6

## Statut

- **Phase** : V2.6 — automatisation contrôlée.
- **Portée** : maintenance locale planifiable par un scheduler externe.
- **Commande** : `npm run catalog:maintain`.
- **MCP** : aucune opération mutable de maintenance n'est exposée au LLM.

## Objectif

La V2.6 ajoute un point d'entrée opérationnel sûr pour maintenir le catalogue local.

Le modèle retenu n'est pas un daemon interne permanent. La maintenance est un cycle court, idempotent et compatible avec un scheduler externe : Windows Task Scheduler, cron, tâche IDE, script utilisateur ou orchestration locale.

## Vérification d'intégrité V2.9

```bash
npm run catalog -- verify --path .data/catalog.db
```

`catalog verify` exécute `PRAGMA integrity_check` et `PRAGMA foreign_key_check`, puis contrôle les
pointeurs de version courante, les versions courantes sans section, les sections courantes absentes
du FTS et les lignes FTS orphelines ou devenues non recherchables. Le JSON expose séparément
`currentSections`, `indexedSections`, les codes stables et le contexte source/document/section. La
commande retourne un code non nul lorsque le statut est `FAILED`.

`catalog rebuild-index` reste une opération explicite de récupération. Une ingestion ou une sync
réussie n'en dépend pas : l'index est mis à jour dans la transaction de révision.

Le registre `catalog_schema_migrations` protège les migrations appliquées par SHA-256. Une erreur
`CATALOG_MIGRATION_CHECKSUM_MISMATCH` doit être traitée comme une dérive du logiciel ou du package,
pas contournée en modifiant le registre.

## Commande

```bash
npm run catalog:maintain -- --path .data/catalog.db
```

Options :

```text
--path <catalog.db>                 Chemin du catalogue.
--keep-sync-runs <n>                Nombre minimal de runs récents à conserver. Défaut : 100.
--max-sync-run-age-days <days>      Âge maximal des runs supprimables. Défaut : 90.
--stale-lock-ms <ms>                Âge maximal d'un lock avant traitement comme obsolète. Défaut : 600000.
--vacuum                            Lance aussi VACUUM hors période d'activité.
```

## Contrat de sortie

La commande écrit un JSON stable sur `stdout` avec :

- `schemaVersion` ;
- `status` ;
- état du lock ;
- résultat de rétention ;
- opérations SQLite exécutées ;
- durée du cycle.

Les diagnostics et événements structurés sont écrits sur `stderr` afin de préserver le transport JSON sur `stdout`.

## Lock inter-processus

La maintenance utilise un lock fichier exclusif adjacent au catalogue.

Règles :

1. un seul cycle de maintenance peut s'exécuter pour un catalogue donné ;
2. un lock existant bloque un second cycle ;
3. un lock plus ancien que `--stale-lock-ms` est considéré obsolète et supprimé ;
4. le lock créé par le cycle courant est supprimé à la fin, succès ou échec.

## Rétention opérationnelle

La V2.6 applique une rétention sur `sync_runs` :

- conserver au minimum les `--keep-sync-runs` runs les plus récents ;
- supprimer les runs plus anciens que `--max-sync-run-age-days` uniquement s'ils ne font pas partie du lot conservé.

Cette rétention ne supprime pas les documents, versions ou sections.

## Maintenance SQLite

Chaque cycle exécute :

- migrations catalogue idempotentes ;
- `PRAGMA analysis_limit = 400` ;
- `PRAGMA optimize` ;
- `PRAGMA wal_checkpoint(TRUNCATE)` ;
- `VACUUM` uniquement avec `--vacuum`.

## Observabilité structurée

Les événements suivants sont émis par le runner :

- `catalog_maintenance_started` ;
- `catalog_maintenance_completed` ;
- `catalog_maintenance_failed` ;
- `catalog_maintenance_stale_lock_removed`.

Les champs sensibles restent soumis au masquage du `StructuredLogger`.

## Limites volontaires

- Pas de daemon interne permanent.
- Pas d'outil MCP mutable de maintenance.
- Pas de suppression automatique de documents ou versions.
- Pas de lancement GitHub Actions.
