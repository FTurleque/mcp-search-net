# Certification clients MCP — état courant

Ce document sépare explicitement les preuves automatisables du serveur des observations qui exigent
une application cliente réelle. Un client STDIO de référence ne prouve jamais à lui seul qu'une
version donnée d'IntelliJ, Claude, Copilot CLI ou Codex expose correctement les mêmes surfaces dans
son interface native.

## Couche automatisée

Le gate `npm run check` construit le serveur puis exécute `npm run client:contract-report`. Cette
sonde utilise `@modelcontextprotocol/sdk@1.30.0` avec `StdioClientTransport` et vérifie sur le binaire
construit :

- cinq tools : `search_web`, `fetch_url`, `search_docs`, `list_docs`, `read_doc_section` ;
- quatre resources statiques ;
- neuf resource templates ;
- annotations read-only / idempotentes / non destructives ;
- `schemaVersion = 1.0` sur la resource catalogue et `structuredContent` ;
- un appel `search_docs` déterministe sans fournisseur Web ;
- absence d'intégration cliente tierce implicite dans le verdict.

Le rapport JSON est écrit sous `.data/test-reports/client-contract-report.json` et fait partie des
artefacts de qualification déterministe lorsque la CI s'exécute. Le test E2E
`tests/e2e/mcp-stdio.test.ts` gèle en parallèle les mêmes contrats ainsi que la pureté JSON-RPC de
`stdout`.

Le lifecycle Windows ajoute une preuve différente : installation du bundle, launcher `.cmd`, sonde
STDIO sur le runtime Node embarqué, upgrade/rollback et uninstall. Cette preuve valide le package
installé mais ne remplace toujours pas une observation dans l'UI d'un client tiers.

## Collecteur de preuve Windows

`scripts/certify-native-clients.ps1` produit une photographie **non destructive** de la machine
Windows utilisée pour #34. Il ne modifie aucune configuration cliente et ne déclenche aucun appel
LLM payant. Il relève uniquement les éléments locaux vérifiables sans interaction humaine :

- version et révision de l'installation `mcp-search-net` via `BUILD-MANIFEST.json` ;
- configuration GitHub Copilot JetBrains sous `%LOCALAPPDATA%\github-copilot\intellij\mcp.json` ;
- GitHub Copilot CLI via `copilot --version`, `copilot mcp list --json` et
  `copilot mcp get mcp-search-net --json` ;
- Claude Code via `claude --version`, `claude mcp list` et `claude mcp get mcp-search-net` ;
- Claude Desktop via son `claude_desktop_config.json` ;
- Codex via `codex --version`, `codex mcp list` et `%USERPROFILE%\.codex\config.toml`.

Le collecteur masque les préfixes de chemins utilisateur courants dans le rapport et n'enregistre
pas les sorties brutes des commandes `mcp get`, afin de ne pas archiver accidentellement des secrets
ou variables d'environnement tierces.

Depuis un checkout Windows du dépôt :

```powershell
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass `
  -File .\scripts\certify-native-clients.ps1
```

Deux fichiers sont générés sous `.data\native-client-certification-<timestamp>` :

- `native-client-certification.json` : preuve structurée ;
- `native-client-certification.md` : résumé prêt à joindre à #34.

Le mode `-SmokeMode` ne touche aucun client réel. Il est exécuté par le workflow
`Native client certification smoke` sous Windows PowerShell 5.1 et vérifie notamment qu'aucun PASS
natif ne peut être inféré automatiquement.

## Matrice de certification native

Tous les clients ci-dessous sont supportés par la configuration de l'installateur et bénéficient de
la preuve serveur automatisée. Leur verdict **natif** est cependant distinct :

- **IntelliJ IDEA + GitHub Copilot — NON OBSERVÉ.** Le 2026-08-04, IntelliJ et le plugin étaient
  présents, mais aucune configuration native `mcp-search-net` exploitable n'avait été enregistrée.
  L'installateur courant utilise `%LOCALAPPDATA%\github-copilot\intellij\mcp.json` avec la racine
  `servers`.
- **GitHub Copilot CLI — NON OBSERVÉ.** Aucune sortie native `copilot mcp` n'est encore enregistrée
  dans #34. La configuration utilisateur courante est `%USERPROFILE%\.copilot\mcp-config.json`.
- **Claude Code — NON OBSERVÉ.** Aucune sortie native `claude mcp` n'est encore enregistrée dans #34.
- **Claude Desktop — NON OBSERVÉ.** Le 2026-08-04, `claude_desktop_config.json` avait été inspecté ;
  `mcpServers` ne contenait pas `mcp-search-net`.
- **Codex — NON OBSERVÉ.** Aucune sortie ou intégration native `codex mcp` n'est encore enregistrée
  dans #34 ; l'installateur utilise `%USERPROFILE%\.codex\config.toml`.

Les observations du 2026-08-04 proviennent de la recette historique
`docs/planning/validation-v2-14-client-contracts.md`. Elles prouvent l'état de configuration au
moment du contrôle ; elles ne doivent ni être extrapolées à une version cliente plus récente, ni être
transformées en PASS.

## Complétion manuelle après collecte

La collecte automatique peut prouver qu'un client est installé, configuré et qu'il sait lister le
serveur. Elle ne prouve pas qu'un modèle a réellement invoqué un tool depuis l'interface native.
Après la collecte, effectuer pour chaque client un appel natif réel, idéalement le workflow compact :

```text
search_docs -> sélectionner un résultat -> read_doc_section
```

Pour IntelliJ/GitHub Copilot et Claude Desktop, consigner l'état du serveur dans l'UI et l'appel de
tool observé. Pour les trois CLI, consigner la version, la sortie `mcp list/get` ou équivalente et
l'appel de tool observé dans une session réelle. L'absence d'interface resources/templates peut être
classée `PASS AVEC RÉSERVE` si les cinq tools sont disponibles et si le workflow documentaire
compact fonctionne.

## Critère de clôture de #34

Une ligne de la matrice ne passe à `PASS` ou `PASS AVEC RÉSERVE` que lorsqu'une version précise du
client, l'OS, le SHA serveur et l'observation correspondante sont enregistrés. En l'absence de cette
preuve, le verdict reste `NON OBSERVÉ`, même si le serveur de référence et le packaging sont verts.

Pour fermer #34 comme `completed`, il faut une observation native des cinq clients. Le collecteur
préremplit les preuves techniques locales mais laisse toujours
`nativeToolInvocationObserved = false`. Ce champ ne peut devenir vrai qu'après une observation
cliente réelle.

GitHub CI peut certifier le contrat serveur, le bundle installé et le collecteur de preuve, mais ne
peut pas fabriquer une observation native d'une application cliente installée sur le poste
utilisateur. Tant que ces cinq preuves ne sont pas enregistrées, #34 doit rester ouverte plutôt que
d'être fermée sur un faux PASS.
