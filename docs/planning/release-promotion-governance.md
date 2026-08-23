# Gouvernance de promotion `develop` vers `master`

## But

La promotion de release ne doit jamais réutiliser comme HEAD de pull request un SHA qui a déjà porté
les checks `push/develop`. Cette règle évite qu'un check `push` annulé ou skippé sur le même SHA soit
présenté par GitHub comme `Required` à côté des checks `pull_request` réussis.

Le flux direct `develop -> master` est donc interdit.

## Invariants

1. `master` doit être un ancêtre de `develop` avant toute promotion. Si ce n'est pas le cas, synchroniser
   d'abord `master` vers `develop` par le flux protégé habituel et attendre les checks requis.
2. Le candidat de promotion doit utiliser une branche dédiée nommée
   `release/promote-develop-YYYYMMDD-HHMMSS` avec éventuellement un suffixe en minuscules.
3. Cette branche part du HEAD courant de `develop` et contient exactement **un commit vide** de
   qualification (`git commit --allow-empty`). Son tree doit rester strictement identique à celui de
   `develop`.
4. Les branches `release/promote-develop-*` ne font pas partie des branches `push` du workflow `CI`.
   Le SHA du candidat reçoit donc les checks `pull_request`, sans héritage d'un run `push/develop` sur
   le même SHA.
5. Le workflow `Release PR contract` re-fetch les HEAD courants de `develop` et `master` et vérifie :
   - que le parent direct du HEAD de la PR est le HEAD courant de `develop` ;
   - que le tree du HEAD de la PR est identique au tree de `develop` ;
   - que `master` est déjà ancêtre de `develop` ;
   - qu'il n'existe qu'un seul commit marqueur au-dessus de `develop` ;
   - que ce commit marqueur n'apporte aucun changement de contenu.
6. Une PR directe depuis `develop` vers `master` doit échouer au contrat de release.
7. Un check marqué `Required` qui n'est pas `Successful` bloque la fusion, y compris `skipped`,
   `cancelled`, `pending`, `queued`, `timed_out`, `stale` ou `missing`.
8. Une branche déclarée `out-of-date` lorsque la règle exige une branche à jour bloque la fusion.
9. Aucun bypass de ruleset ou `Merge without waiting for requirements` n'est autorisé dans le flux
   normal de release.
10. Une autorisation explicite de fusion est requise immédiatement avant chaque merge. Une autorisation
    de merge ne vaut jamais autorisation de publication.

## Préparer le candidat de promotion

Après qualification de `develop` et après avoir vérifié que `master` est bien ancêtre de `develop` :

```bash
git fetch origin develop master
git merge-base --is-ancestor origin/master origin/develop

git switch --detach origin/develop
git switch -c release/promote-develop-YYYYMMDD-HHMMSS
git commit --allow-empty -m "release: qualify develop promotion"
git push -u origin HEAD
```

La commande `git merge-base --is-ancestor` doit retourner `0`. Sinon, ne pas créer la promotion :
resynchroniser d'abord `master` dans `develop`.

Ensuite ouvrir la PR de la branche `release/promote-develop-*` vers `master` avec le corps imposé par
`scripts/check-release-pr-contract.mjs`.

## Readiness de merge

Le verdict est mécanique :

```text
ANY Required != Successful  => READY_TO_MERGE=NO
branch out-of-date           => READY_TO_MERGE=NO
ruleset bypass nécessaire    => READY_TO_MERGE=NO
```

Une exécution plus récente réussie ne permet jamais d'ignorer un item que l'interface GitHub expose
encore comme `Required` et non réussi pour le candidat courant.

## Après une promotion vers `master`

Le merge de promotion crée un nouveau commit sur `master`. Avant la promotion suivante, ce nouveau
historique doit être réintégré dans `develop`. Le contrat de promotion suivant bloquera automatiquement
si `origin/master` n'est pas ancêtre de `origin/develop`.

La CI `push/master` du SHA final doit ensuite réussir avant tout `Publish Windows Release` en
`validate_only=true`. La publication réelle (`validate_only=false`) reste interdite tant que la
certification native 3/3 exact-head n'est pas enregistrée et qu'une autorisation de publication séparée
n'a pas été donnée.
