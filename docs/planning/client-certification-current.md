# Certification clients MCP — état courant

Ce document sépare explicitement les preuves automatisables du serveur des observations qui exigent
une application cliente réelle. Un client STDIO de référence ne prouve jamais à lui seul qu'une
version donnée d'un client tiers expose correctement les mêmes surfaces dans son interface native.

## Périmètre de certification retenu

Depuis la clôture de l'issue #34 le 10 août 2026, le périmètre de certification native retenu est :

1. Claude Code ;
2. Claude Desktop ;
3. Codex.

GitHub Copilot CLI et IntelliJ IDEA + GitHub Copilot sont **hors périmètre de certification**. Leur
compatibilité d'installation peut rester supportée pour les utilisateurs qui en ont besoin, mais
aucun nouveau test Copilot n'est requis pour qualifier ou fermer #34.

La certification finalisée ci-dessous est liée au runtime Windows 10 réellement installé :

```text
version        = 1.1.0
sourceRevision = a70b9a51527543c9417566326bb780121954cef5
sourceState    = CLEAN
nodeVersion    = 24.18.0
```

Les évolutions documentaires ou du harness postérieures à cette preuve ne réécrivent pas
rétroactivement le SHA du runtime certifié.

## Couche automatisée

Le gate `npm run check` construit le serveur puis exécute `npm run client:contract-report`. Cette
sonde utilise `@modelcontextprotocol/sdk@1.30.0` avec `StdioClientTransport` et vérifie sur le binaire
construit :

- six tools avec le profil de développement, qui active explicitement `history.exposeTool: true` : `search_web`, `fetch_url`, `search_docs`, `list_docs`, `read_doc_section`, `list_search_history` ;
- quatre resources statiques ;
- neuf resource templates ;
- annotations read-only / idempotentes / non destructives ;
- `schemaVersion = 1.0` sur la resource catalogue et `structuredContent` ;
- un appel `search_docs` déterministe sans fournisseur Web ;
- absence d'intégration cliente tierce implicite dans le verdict.

Les profils de production Windows et Docker utilisent par défaut `history.enabled: false` et
`history.exposeTool: false`; `list_search_history` n'y est donc pas enregistré sans opt-in explicite.

Le rapport JSON est écrit sous `.data/test-reports/client-contract-report.json`. Il décrit le
contrat serveur et le périmètre de certification native, mais ne transforme jamais une sonde SDK en
preuve d'appel natif depuis Claude ou Codex.

Le lifecycle Windows ajoute une preuve différente : installation du bundle, launcher `.cmd`, sonde
STDIO sur le runtime Node embarqué, upgrade/rollback et uninstall. Cette preuve valide le package
installé mais ne remplace pas une observation dans l'UI ou la CLI d'un client tiers.

## Collecteur de preuve Windows

`scripts/certify-native-clients.ps1` produit une photographie **non destructive** des trois clients
retenus pour la certification native. Il ne modifie aucune configuration cliente et ne déclenche
aucun appel LLM payant. Il relève uniquement les éléments locaux vérifiables sans interaction
humaine :

- version et révision de l'installation `mcp-search-net` via `BUILD-MANIFEST.json` ;
- Claude Code via `claude --version`, `claude mcp list` et `claude mcp get mcp-search-net` ;
- Claude Desktop via son `claude_desktop_config.json` et sa version locale ;
- Codex via `codex --version`, `codex mcp list` et `%USERPROFILE%\.codex\config.toml` lorsque ces
  commandes sont disponibles.

Le collecteur ne sonde plus GitHub Copilot CLI ni IntelliJ/GitHub Copilot. Le support d'installation
Copilot reste séparé du périmètre de certification et n'est pas supprimé par cette décision.

Depuis un checkout Windows du dépôt :

```powershell
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass `
  -File .\scripts\certify-native-clients.ps1
```

Deux fichiers sont générés sous `.data\native-client-certification-<timestamp>` :

- `native-client-certification.json` : preuve structurée ;
- `native-client-certification.md` : résumé prêt à joindre à une future qualification manuelle.

Le mode `-SmokeMode` ne touche aucun client réel. Le workflow `Native client certification smoke`
sous Windows PowerShell 5.1 vérifie notamment que le collecteur produit exactement trois lignes de
certification et qu'aucun PASS natif ne peut être inféré automatiquement.

## Matrice native finalisée — 3/3

### Claude Code 2.1.225 — CERTIFIÉ

Session native Claude Code 2.1.225 sur Windows 10, runtime serveur
`a70b9a51527543c9417566326bb780121954cef5` :

```text
search_docs        = OBSERVÉ
returned sectionId = 9
read_doc_section   = OBSERVÉ
used sectionId     = 9
section found      = true
```

Le `sectionId=9` retourné par `search_docs` a été réutilisé exactement dans
`read_doc_section(9)`.

**Verdict Claude Code : PASS NATIF.**

### Claude Desktop 1.26832.0 — CERTIFIÉ

Session native Claude Desktop 1.26832.0 sur Windows 10, runtime serveur
`a70b9a51527543c9417566326bb780121954cef5` :

```text
search_docs requestId      = 59b183b4-112f-40fe-b527-99b8fdcae023
returned sectionId         = 9
read_doc_section requestId = b3196950-da47-4027-8b5d-b3ff3810e893
used sectionId             = 9
section found              = true
truncated                  = false
characterCount             = 901
```

**Verdict Claude Desktop : PASS NATIF.**

### Codex 26.803.5235.0 — CERTIFIÉ

Session native Codex 26.803.5235.0 sur Windows 10. La version a été récupérée depuis le package MSIX
exact du processus Codex actif, `codex --version` ayant été refusé par Windows.

```text
search_docs tool           = mcp__mcp_search_net__search_docs
search_docs requestId      = 2260b551-e143-417e-94f5-886a28a3c9e1
returned sectionId         = 9
read_doc_section tool      = mcp__mcp_search_net__read_doc_section
read_doc_section requestId = d6dbad89-b224-45f3-830f-fef26c23983b
used sectionId             = 9
section found              = true
truncated                  = false
characterCount             = 901
```

La chaîne native a vérifié automatiquement l'égalité :

```text
search_docs.sectionId      = 9
read_doc_section.sectionId = 9
exact match                = YES
```

**Verdict Codex : PASS NATIF.**

## Statut de #34

La matrice retenue est désormais :

- [x] Claude Code 2.1.225 ;
- [x] Claude Desktop 1.26832.0 ;
- [x] Codex 26.803.5235.0.

**Matrice finale : 3/3 CERTIFIÉS pour `a70b9a51527543c9417566326bb780121954cef5`.**

L'issue #34 est fermée avec `state_reason=completed` depuis le 10 août 2026. Cette fermeture ne
certifie pas automatiquement les SHA serveur ultérieurs.

## Requalification exacte avant publication

Une preuve native reste liée à une version cliente, un OS et un SHA serveur précis. Le collecteur
peut préremplir les preuves techniques locales, mais `nativeToolInvocationObserved` reste `false`
jusqu'à une vraie invocation cliente.

Après promotion d'un candidat sur `master`, la requalification publiée suit désormais ce flux :

1. installer/exécuter le runtime correspondant exactement au HEAD `master` candidat ;
2. lancer le collecteur local (`scripts/certify-native-clients.ps1`) et conserver l'intégralité du
   JSON de son rapport (pas seulement un hash) ; le rapport porte désormais `serverVersion`,
   `sourceRevision` et `sourceState` lus depuis le `BUILD-MANIFEST.json` de l'installation locale ;
3. dans **Claude Code**, effectuer `search_docs`, relever le `sectionId` réel, puis appeler
   `read_doc_section` avec exactement cet identifiant et conserver les deux `requestId` ;
4. répéter la même observation dans **Claude Desktop** ;
5. répéter la même observation dans **Codex** ;
6. déclencher manuellement le workflow GitHub Actions `Native client certification record` sur
   `master` et fournir pour chacun des trois clients un JSON contenant `schemaVersion`, `client`,
   `clientVersion`, `os`, `serverVersion`, `sourceRevision` (doit être strictement égal au SHA
   `master` certifié), `sourceState: CLEAN`, `nodeVersion`, `searchRequestId`, `readRequestId`
   (différent de `searchRequestId`), `searchSectionId`, `readSectionId` (identique à
   `searchSectionId`), `sectionFound: true`, `truncated`, `characterCount`,
   `nativeToolInvocationObserved: true`, `observedAt` et `verdict: PASS_NATIVE`, ainsi que
   `collector_report_json` (le contenu JSON complet du rapport du collecteur, et non plus
   seulement son empreinte déclarée) ;
7. le workflow valide chaque champ ci-dessus pour les trois clients, vérifie que les trois
   `sourceRevision` sont strictement égaux au SHA `master` certifié, recalcule lui-même le
   SHA-256 du rapport du collecteur reçu (jamais une empreinte simplement déclarée par
   l'appelant), et produit l'artefact `native-client-certification-<SHA>` avec le verdict global
   `PASS_NATIVE_3_OF_3` uniquement si les trois clients (et exactement ces trois, sans doublon)
   sont valides.

Le gate de publication Windows (`scripts/release/assert-native-client-certification.ps1`)
recherche un run `workflow_dispatch` réussi sur le **même SHA exact de `master`**, **télécharge
réellement l'artefact correspondant**, revalide indépendamment tout son contenu (schéma,
`repository`, `sourceRevision`, `verdict`, les trois clients et chacun de leurs champs) et refuse
la publication si l'artefact est absent, expiré, mal formé, ou incohérent avec le SHA certifié —
l'existence d'un artefact du bon nom ne suffit plus jamais à elle seule. `validate_only` reste
utilisable sans cette preuve pour construire et inspecter un candidat, mais aucun
`gh release create` n'est possible sans certification native exact-head validée de bout en bout.

### Flux de release complet (rappel)

1. développement/corrections sur `develop` ;
2. CI `develop` verte ;
3. promotion vers `master` ;
4. CI push/`master` verte sur le SHA exact `R` ;
5. `Publish Windows Release` avec `validate_only=true` (build/inspection uniquement, aucune
   certification native requise) ;
6. téléchargement/installation du candidat construit à partir de `R` ;
7. vérification locale : `BUILD-MANIFEST.sourceRevision == R` et `sourceState == CLEAN` ;
8. seulement ensuite : observations natives Claude Code, Claude Desktop, Codex sur `R` ;
9. chacun produit une preuve native pour **exactement** `R` ;
10. `Native client certification record` sur `master`/`R` avec les trois preuves ;
11. création de l'artefact `native-client-certification-R` ;
12. le gate de release télécharge et revalide cet artefact ;
13. `Publish Windows Release` avec `validate_only=false` ;
14. publication uniquement si CI exact-head PASS, certification exact-head
    `PASS_NATIVE_3_OF_3` et provenance PASS ; lorsque la signature Authenticode (optionnelle,
    désactivée par défaut) est activée pour ce candidat, elle doit en plus être PASS (identité de
    certificat épinglée) — une publication volontaire sans Authenticode reste supportée.

**Ne jamais certifier `develop`. Ne jamais certifier un SHA intermédiaire. Ne jamais lancer les
observations clientes avant que le SHA final de `master` soit figé.** Une certification produite
pour un SHA qui n'est plus le HEAD final de `master` ne peut pas servir de preuve pour la
publication suivante ; elle reste un historique valide de ce qui a été observé, mais une nouvelle
certification exact-head est requise après tout nouveau commit sur `master`.

Le workflow recommandé d'observation reste :

```text
search_docs -> relever le sectionId réel -> read_doc_section(exactement ce sectionId)
```

Une simple configuration, un `mcp list`, un `mcp get`, un état `connected`, la sonde STDIO de
référence ou le workflow smoke ne suffisent jamais à établir un nouveau PASS natif.
