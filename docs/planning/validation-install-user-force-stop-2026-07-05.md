# Validation installation utilisateur force-stop

Le wrapper `scripts/intellij/install-user-force-stop.cmd` a été validé localement.

Résultat :

- validation projet OK ;
- format OK ;
- lint OK ;
- typecheck OK ;
- build OK ;
- tests OK ;
- 37 fichiers de tests passés ;
- 183 tests passés ;
- installation utilisateur terminée ;
- lanceur MCP généré dans le dossier utilisateur.

Décision :

- le wrapper standard reste conservateur ;
- le wrapper force-stop permet une réinstallation explicite quand une ancienne instance est encore active.
