# Verrou d'installation utilisateur

L'installation utilisateur peut s'arrêter si une ancienne instance `mcp-search-net` est encore active.

Ce comportement est normal : il évite de remplacer une application en cours d'utilisation par IntelliJ, GitHub Copilot ou un autre client MCP.

Quand cela arrive, fermer IntelliJ/Copilot ou arrêter proprement le client qui utilise `mcp-search-net`, puis relancer l'installation.

Le script PowerShell `scripts/install-user.ps1` supporte déjà l'option avancée `-ForceStopExistingProcess`. Elle arrête les processus `mcp-search-net` détectés avant de poursuivre l'installation.

Dans IntelliJ, la configuration `MCP - Install user (Windows)` conserve le comportement sûr par défaut. La configuration `MCP - Install user force stop (Windows)` passe explicitement `-ForceStopExistingProcess` pour les réinstallations où l'arrêt de l'ancienne instance est volontaire.

Ce mode doit rester une option avancée. Le comportement par défaut doit continuer à protéger l'application en cours d'utilisation et à afficher les processus suspects plutôt que les arrêter automatiquement.

La détection compare la ligne de commande aux chemins exacts du lanceur et du
`build/bootstrap/main.js` installés, exclut la lignée du processus installateur,
et affiche PID, nom et ligne de commande. L'échec conserve le staging pour
diagnostic. Ne supprimer aucun PID uniquement sur son nom `node.exe`.

Ce verrou d'installation est distinct du lease de maintenance
`catalog.db.maintenance.lock`, décrit dans le guide d'exploitation du catalogue.
