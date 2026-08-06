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

| Client                         | Configuration supportée par l'installateur | Preuve serveur automatisée | Observation native requise                                                                                  |
| ------------------------------ | ------------------------------------------ | -------------------------- | ----------------------------------------------------------------------------------------------------------- |
| IntelliJ IDEA + GitHub Copilot | oui                                        | oui                        | serveur `Running`, cinq tools, workflow `search_docs -> read_doc_section`, resources/templates selon plugin |
| GitHub Copilot CLI             | oui                                        | oui                        | `copilot mcp` réel, visibilité et appel des tools                                                           |
| Claude Code                    | oui                                        | oui                        | `claude mcp` réel, visibilité et appel des tools                                                            |
| Claude Desktop                 | oui                                        | oui                        | chargement de `claude_desktop_config.json`, visibilité et appel des tools                                   |
| Codex                          | oui                                        | oui                        | `codex mcp` réel, visibilité et appel des tools                                                             |

## Règle de verdict

Une ligne de la matrice ne passe à `PASS` ou `PASS AVEC RÉSERVE` que lorsqu'une version précise du
client, l'OS, le SHA serveur et l'observation correspondante sont enregistrés. En l'absence de cette
preuve, le verdict reste `NON OBSERVÉ`, même si le serveur de référence et le packaging sont verts.

Cette séparation permet de livrer et maintenir un contrat MCP portable sans transformer une recette
manuelle non exécutée en faux résultat de certification.
