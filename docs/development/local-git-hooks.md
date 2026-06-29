# Hooks Git locaux

GitHub ne permet pas la protection de branches sur ce depot prive sans GitHub
Pro ou depot public. Le depot fournit donc des hooks locaux pour reduire le
risque de push direct accidentel.

Installation locale :

```powershell
.\scripts\install-local-git-hooks.ps1
```

Effets :

- `pre-commit` bloque les commits sur `master`, `main` et `release/*` ;
- `pre-push` bloque les pushes directs vers `master`, `main` et `release/*` ;
- `pre-push` bloque aussi le deplacement du tag `v1.0.0` ;
- les pushes vers des branches de travail, par exemple `feature/...`, restent
  autorises.

Flux attendu :

```powershell
git switch -c feature/ma-modification
git push -u github feature/ma-modification
```

Ensuite, ouvrir une pull request et la merger soi-meme sur GitHub. Le hook
n'impose aucune approbation collaborateur.

Limite : un hook local protege uniquement cette copie de travail. Une autre
machine ou un autre clone doit installer les hooks aussi.
