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

## Matrice de certification native

Tous les clients ci-dessous sont supportés par la configuration de l'installateur et bénéficient de
la preuve serveur automatisée. Leur verdict **natif** est cependant distinct :

- **IntelliJ IDEA + GitHub Copilot — NON OBSERVÉ.** Le 2026-08-04, IntelliJ et le plugin étaient
  présents, mais `%APPDATA%\GitHub Copilot\mcp.json` était absent et le serveur n'était donc pas
  déclaré.
- **GitHub Copilot CLI — NON OBSERVÉ.** Aucune sortie native `copilot mcp` n'est enregistrée.
- **Claude Code — NON OBSERVÉ.** Aucune sortie native `claude mcp` n'est enregistrée.
- **Claude Desktop — NON OBSERVÉ.** Le 2026-08-04, `claude_desktop_config.json` avait été inspecté ;
  `mcpServers` ne contenait pas `mcp-search-net`.
- **Codex — NON OBSERVÉ.** Aucune sortie ou intégration native `codex mcp` n'est enregistrée.

Les observations du 2026-08-04 proviennent de la recette historique
`docs/planning/validation-v2-14-client-contracts.md`. Elles prouvent l'absence de configuration au
moment du contrôle ; elles ne doivent ni être extrapolées à une version cliente plus récente, ni être
transformées en PASS.

## Critère de clôture de #34

Une ligne de la matrice ne passe à `PASS` ou `PASS AVEC RÉSERVE` que lorsqu'une version précise du
client, l'OS, le SHA serveur et l'observation correspondante sont enregistrés. En l'absence de cette
preuve, le verdict reste `NON OBSERVÉ`, même si le serveur de référence et le packaging sont verts.

Pour fermer #34 comme `completed`, il faut donc encore fournir une observation native des cinq
clients. Pour les clients CLI, enregistrer au minimum la version, `mcp list/get` (ou commande native
équivalente), puis un appel réel d'au moins un tool. Pour IntelliJ/Copilot et Claude Desktop,
enregistrer la configuration chargée, l'état du serveur et l'appel réel d'un tool dans le client.
Resources/templates peuvent rester une réserve si le client ne les expose pas directement, à
condition que le workflow `search_docs -> read_doc_section` soit réellement observé.

GitHub CI peut certifier le contrat serveur et le bundle installé, mais ne peut pas fabriquer une
observation native d'une application cliente installée sur le poste utilisateur. Tant que ces cinq
preuves ne sont pas enregistrées, #34 doit rester ouverte plutôt que d'être fermée sur un faux PASS.
