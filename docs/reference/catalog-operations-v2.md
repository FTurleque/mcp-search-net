# Exploitation catalogue V2.12

## Statut

- **Phase historique d'introduction** : V2.12 — exploitation locale durcie.
- **État courant** : commandes présentes dans le candidat `1.1.0`, dont le verdict de livraison
  reste celui de [`docs/status/current-state.md`](../status/current-state.md).
- **Portée** : santé, snapshot, restauration documentée et maintenance planifiable.
- **Commandes** : `catalog health`, `catalog backup` et `npm run catalog:maintain`.
- **MCP** : aucune opération mutable de maintenance n'est exposée au LLM.

Dans une installation Windows, remplacer `npm run catalog --` par
`%LOCALAPPDATA%\mcp-search-net\bin\mcp-search-net-catalog.cmd` et
`npm run catalog:maintain --` par
`%LOCALAPPDATA%\mcp-search-net\bin\mcp-search-net-maintain.cmd`. Ces wrappers utilisent le runtime
et le build installés, avec `data\catalog.db` par défaut.

## Objectif

La V2.12 consolide les points d'entrée opérationnels sûrs du catalogue local.

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

## Santé locale

```bash
npm run catalog:health -- --path .data/catalog.db
```

La commande expose les nombres de sources et documents ainsi que le rapport
complet de `catalog verify`. Les comptages utilisent les requêtes SQL bornées du
repository et ne chargent pas l'ensemble des sources ou documents en mémoire.
Elle renvoie `healthy` et un code zéro uniquement si l'intégrité SQLite, les clés
étrangères, les révisions courantes et le FTS sont cohérents. `degraded` ou une
base physiquement illisible produisent un code non nul : ce résultat ne doit pas
être masqué par un simple test d'existence du fichier.

## Snapshot et restauration

Créer un snapshot cohérent pendant que des lecteurs ou un writer WAL sont
actifs :

```bash
npm run catalog -- backup --path .data/catalog.db --output catalog-2026-07-29.db
```

`--output` fournit un nom de fichier, pas un emplacement libre. Seuls les noms
ASCII bornés composés de lettres, chiffres, `.`, `_` et `-`, terminés par `.db`,
sont acceptés. Même si l'appelant fournit un chemin, seul son nom de fichier
validé est conservé. Le snapshot est toujours publié dans le sous-répertoire
`backups/` adjacent au catalogue ; avec l'exemple ci-dessus, la destination est
`.data/backups/catalog-2026-07-29.db`. Cette règle empêche `catalog backup`
d'écrire arbitrairement ailleurs dans le système de fichiers.

La commande utilise l'API de sauvegarde en ligne SQLite, vérifie le snapshot,
calcule son SHA-256 et le publie seulement après validation. Elle refuse une
source absente, un nom de snapshot invalide ou une destination déjà existante.

Procédure de restauration :

1. arrêter les processus MCP, sync et maintenance qui utilisent le catalogue ;
2. conserver le fichier dégradé et ses éventuels `-wal`/`-shm` pour diagnostic ;
3. vérifier le SHA-256 du snapshot et exécuter `catalog verify` dessus ;
4. copier le snapshot vers un nouveau chemin, puis pointer `MCP_CATALOG_PATH`
   vers ce chemin ;
5. exécuter `catalog health` avant de remettre les clients en service.

Ne jamais recopier un snapshot par-dessus une base ouverte. Les tests couvrent
le snapshot sous writer WAL non validé, le confinement du chemin de sortie, le
refus d'écrasement, la corruption détectée et la restauration saine.

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

Le lock contient un token de propriétaire, PID, hostname, création et heartbeat.
Il est créé atomiquement avec des permissions utilisateur. Règles :

1. un seul cycle de maintenance peut s'exécuter pour un catalogue donné ;
2. le cycle renouvelle son heartbeat entre les opérations longues ;
3. l'âge seul ne permet jamais de supprimer un lock : le hostname doit être
   local et le PID doit être confirmé mort ;
4. une métadonnée invalide ou un propriétaire distant exige une récupération
   manuelle ;
5. la récupération stale passe par un renommage de quarantaine et revérifie le
   token pour fermer la course entre deux processus ;
6. un lease ne supprime à la fin que le fichier portant encore son propre token.

Ces règles sont testées avec deux vrais processus sous le runtime hôte et ne
dépendent pas d'un `mtime` fragile.

## Rétention opérationnelle

La V2.6 applique une rétention sur `sync_runs` :

- conserver au minimum les `--keep-sync-runs` runs les plus récents ;
- supprimer les runs plus anciens que `--max-sync-run-age-days` uniquement s'ils ne font pas partie du lot conservé.

Cette rétention ne supprime pas les documents, versions, sections, aliases ou événements. Avant de
supprimer un ancien run, elle détache ses `staleness_events` en mettant `sync_run_id` à `NULL`. Elle
ne transforme pas un ancien run `RUNNING` en statut terminal : un run abandonné doit d'abord être
diagnostiqué ; lorsqu'il devient supprimable selon l'âge et le lot conservé, la rétention peut le
purger comme toute autre ligne.

## Maintenance SQLite

Chaque cycle exécute :

- migrations catalogue idempotentes ;
- `PRAGMA analysis_limit = 400` ;
- `PRAGMA optimize` ;
- `PRAGMA wal_checkpoint(TRUNCATE)` avec contrôle du champ `busy` réellement
  retourné par SQLite ;
- `VACUUM` uniquement avec `--vacuum`.

Un checkpoint `TRUNCATE` empêché par un lecteur SQLite actif n'est jamais déclaré
réussi : la maintenance échoue explicitement avec
`CATALOG_WAL_CHECKPOINT_BUSY`, libère son lease et peut être rejouée après la fin
du lecteur.

## Observabilité structurée

Les événements suivants sont émis par le runner :

- `catalog_maintenance_started` ;
- `catalog_maintenance_completed` ;
- `catalog_maintenance_failed` ;
- `file_lease_lock_stale_recovered` ;
- `file_lease_lock_release_owner_mismatch`.

Les champs sensibles restent soumis au masquage du `StructuredLogger`.

## Limites volontaires

- Pas de daemon interne permanent.
- Pas d'outil MCP mutable de maintenance.
- Pas de suppression automatique de documents ou versions.
