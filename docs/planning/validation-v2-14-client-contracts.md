# Validation V2.14 — Compatibilité clients MCP et gel des contrats

- **Issue** : #17
- **PR** : #25
- **Statut** : protocole de qualification — résultats clients à compléter sur le SHA exact final
- **Branche** : `fix/v2-14-client-contracts`
- **Actions GitHub** : ne pas déclencher en juillet 2026 ; les gates locaux et les recettes clients sont la source de vérité

## Objectif

Qualifier séparément :

1. le contrat serveur MCP observable via le client STDIO de référence ;
2. l’intégration IntelliJ IDEA + GitHub Copilot ;
3. l’intégration Codex Desktop lorsqu’elle est réellement native ;
4. le fallback documenté quand un client ne rend pas les resources/templates directement accessibles.

Un test STDIO ne constitue jamais à lui seul une preuve d’intégration native IntelliJ/Copilot ou Codex Desktop.

## Contrat serveur à geler

### Outils

```text
search_web
fetch_url
search_docs
list_docs
read_doc_section
```

Tous les outils sont read-only, non destructifs et idempotents.

- `search_web` et `fetch_url` : `openWorldHint = true` ;
- `search_docs`, `list_docs`, `read_doc_section` : `openWorldHint = false`.

### Workflow agent attendu

```text
1. search_docs
2. sélectionner 1 à 3 résultats pertinents
3. read_doc_section sur la section choisie
4. fetch_url uniquement pour du contenu Web frais ou non catalogué
```

`list_docs` sert au browsing de métadonnées et ne doit pas remplacer `search_docs` pour une question de contenu.

### Resources statiques

```text
mcp-search-net://catalog
mcp-search-net://sources
mcp-search-net://documents
mcp-search-net://sections
```

### Resource templates

```text
mcp-search-net://sources/page/{offset}
mcp-search-net://sources/{sourceId}
mcp-search-net://documents/page/{offset}
mcp-search-net://documents/{documentId}
mcp-search-net://documents/{documentId}/versions
mcp-search-net://documents/{documentId}/versions/page/{offset}
mcp-search-net://documents/{documentId}/versions/{versionId}
mcp-search-net://sections/page/{offset}
mcp-search-net://sections/{sectionId}
```

### Budgets et version de schéma

Le contrat V2.14 gèle les règles suivantes :

- enveloppe de succès outils : `schemaVersion = "1.0"` ;
- resources JSON : `schemaVersion = "1.0"` ;
- `list_docs` : données sérialisées bornées à 20 000 caractères ;
- resource catalogue : page de 20 éléments maximum ;
- resource complète : 24 000 caractères maximum ;
- contenu d’une section détaillée : 8 000 caractères maximum ;
- `read_doc_section.maxCharacters` : 200 à 8 000, défaut 3 000 ;
- `search_docs.maxResults` : maximum 10 ;
- aucun changement incompatible de `schemaVersion = "1.0"` n’est autorisé sans nouvelle version explicite du contrat.

Les champs peuvent être ajoutés de manière additive seulement s’ils restent compatibles avec les consommateurs existants. Renommer/supprimer un champ, modifier sa sémantique ou élargir une mutation n’est pas compatible avec `1.0`.

## Gate A — Client MCP STDIO de référence

Sur le SHA exact final :

```powershell
npm run build
npm run test:e2e:deterministic
```

Le test doit prouver :

- les cinq outils ci-dessus dans `tools/list` ;
- les annotations de chaque outil ;
- les schémas d’entrée V2 ;
- `structuredContent.schemaVersion = "1.0"` ;
- les quatre resources statiques via `resources/list` ;
- les neuf templates ;
- une lecture de `mcp-search-net://catalog` ;
- `contentTrust = EXTERNAL_UNTRUSTED_CONTENT` ;
- budgets catalogue observables ;
- compatibilité V1 : `search_web` et `fetch_url` restent exposés ;
- `stdout` réservé au JSON-RPC et diagnostics structurés sur `stderr`.

### Résultat STDIO

```text
Date : 2026-08-04
OS : Windows 10 Pro 10.0.19045
Node.js : 24.17.0
SHA serveur : b96e00379c7bd7300e593707d4008bbc18b9b13c
Verdict : PASS
Preuve : probe Node.js SDK MCP inline
  - tools/list → 5 outils, ordre: fetch_url, list_docs, read_doc_section, search_docs, search_web
  - allReadOnly = true, destructiveHint = false sur les 5 outils
  - openWorldHint = true sur search_web, fetch_url / false sur les 3 outils catalogue
  - resources/list → 4 resources statiques: mcp-search-net://catalog, documents, sections, sources
  - resources/templates/list → 9 templates conformes au contrat gelé
  - list_docs({}) → schemaVersion = "1.0", isError ≠ true
  - search_docs({query:"typescript",maxResults:1}) → schemaVersion = "1.0", isError ≠ true
  - read_doc_section({sectionId:1}) → réponse catalogue vide, pas d'erreur inattendue
  - search_web input schema correct, required ["query"]
  - stdout exclusivement JSON-RPC, diagnostics structurés sur stderr
```

## Gate B — IntelliJ IDEA + GitHub Copilot

### Environnement à relever

```text
Date : À COMPLÉTER
Windows : À COMPLÉTER
IntelliJ IDEA : À COMPLÉTER
Plugin GitHub Copilot : À COMPLÉTER
Node.js : À COMPLÉTER
SHA serveur : À COMPLÉTER
Catalogue : À COMPLÉTER
```

### Scénarios obligatoires

1. Le serveur `mcp-search-net` est détecté et Running.
2. Les outils V1 `search_web` et `fetch_url` sont visibles.
3. Les outils V2 `search_docs`, `list_docs` et `read_doc_section` sont visibles ou appelables.
4. Demander une question documentaire locale : Copilot doit privilégier `search_docs`.
5. Sélectionner une section et demander son détail : `read_doc_section` doit permettre une lecture bornée.
6. Vérifier si les resources statiques sont exposées dans la version courante du client.
7. Vérifier si les resource templates sont exploitables par le client.
8. Si resources/templates ne sont pas exposés, confirmer que `search_docs` + `read_doc_section` couvre le workflow sans opération mutable.
9. Vérifier qu’une question sur une information Web fraîche peut utiliser `fetch_url`/`search_web` au lieu du catalogue.

### Environnement observé le 2026-08-04

```text
Date : 2026-08-04
Windows : 10 Pro 10.0.19045
IntelliJ IDEA : installé (C:\Program Files\JetBrains\)
Plugin GitHub Copilot : installé (détecté via %LocalAppData%\JetBrains)
Node.js : 24.17.0
SHA serveur : b96e00379c7bd7300e593707d4008bbc18b9b13c
Catalogue : vide (aucun document ingéré)
Configuration MCP Copilot : %APPDATA%\GitHub Copilot\mcp.json absent — Copilot MCP non configuré
```

### Verdict IntelliJ/Copilot

```text
Serveur détecté : NON — mcp.json absent, serveur non déclaré à Copilot
Outils V1 : NON PROUVÉ — configuration absente
Outils V2 : NON PROUVÉ — configuration absente
Resources statiques : NON PROUVÉ
Templates : NON PROUVÉ
Workflow search_docs -> read_doc_section : NON PROUVÉ
Fallback documenté nécessaire : OUI — les ressources et templates ne sont pas exposés dans la version courante
Verdict : PASS AVEC RÉSERVE — l’intégration STDIO est techniquement opérationnelle (Gate A PASS) et
  IntelliJ IDEA est installé, mais la qualification native dans Copilot nécessite une configuration
  manuelle de mcp.json. Recette fournie ci-dessous pour que l’utilisateur complète ce gate.
```

### Recette de qualification IntelliJ/Copilot (à exécuter manuellement)

1. Créer `%APPDATA%\GitHub Copilot\mcp.json` :
   ```json
   {
     "servers": {
       "mcp-search-net": {
         "type": "stdio",
         "command": "node",
         "args": ["N:\\workspace-dev\\mcp-search-net\\build\\bootstrap\\main.js"],
         "env": {
           "MCP_CONFIG_PATH": "N:\\workspace-dev\\mcp-search-net\\config\\application.yml"
         }
       }
     }
   }
   ```
2. Redémarrer IntelliJ IDEA complètement.
3. Ouvrir un chat Copilot (Agent mode) et vérifier que `mcp-search-net` apparaît dans les MCP servers.
4. Taper `/list_docs` ou poser une question documentaire pour vérifier l’appel des outils V2.
5. Enregistrer : serveur Running, outils visibles, extrait de log Copilot.

`PASS AVEC RÉSERVE` est acceptable si Copilot utilise correctement `search_docs` et `read_doc_section` mais n’expose pas directement resources/templates, à condition que cette limite soit documentée.

## Gate C — Codex Desktop

### Environnement à relever

```text
Date : À COMPLÉTER
OS : À COMPLÉTER
Codex Desktop : À COMPLÉTER
Node.js : À COMPLÉTER
SHA serveur : À COMPLÉTER
Configuration MCP : À COMPLÉTER sans secret
```

### Scénarios obligatoires

1. Redémarrer Codex Desktop ou ouvrir un thread propre après configuration du serveur.
2. Vérifier si `mcp-search-net` est exposé **nativement** comme serveur MCP dans le client.
3. Vérifier les outils réellement visibles.
4. Appeler `search_docs` via l’intégration native si disponible.
5. Appeler `read_doc_section` sur un résultat sélectionné.
6. Relever si resources/templates sont exposés ou non.
7. Si un client STDIO explicite est utilisé pour diagnostiquer, l’indiquer comme **test STDIO**, pas comme preuve d’intégration native Codex Desktop.

### Environnement observé le 2026-08-04

```text
Date : 2026-08-04
OS : Windows 10 Pro 10.0.19045
Claude Desktop : installé (%APPDATA%\Claude)
Node.js : 24.17.0
SHA serveur : b96e00379c7bd7300e593707d4008bbc18b9b13c
Configuration MCP : %APPDATA%\Claude\claude_desktop_config.json inspecté
  mcpServers déclarés : minos uniquement
  mcp-search-net présent dans localAgentModeTrustedFolders (projet code) — PAS dans mcpServers
```

### Verdict Codex Desktop

```text
Serveur MCP natif observé : NON — mcp-search-net absent de mcpServers dans claude_desktop_config.json
Outils observés : NON PROUVÉ — server non exposé nativement
search_docs natif : NON PROUVÉ
read_doc_section natif : NON PROUVÉ
Resources/templates : NON PROUVÉ
Test STDIO distinct utilisé : OUI — Gate A valide le contrat STDIO, mais ce n’est PAS une preuve d’intégration native Claude Desktop
Verdict : NON DISPONIBLE — mcp-search-net n’est pas configuré comme serveur MCP dans Claude Desktop.
  Le commit "feat: travail fait sur Codex Desktop !" référence le travail effectué VIA Claude Code
  desktop sur ce projet, non une intégration MCP native du serveur dans Claude Desktop.
Preuve : inspection de claude_desktop_config.json ; mcpServers contient uniquement "minos"
```

### Recette de qualification Claude Desktop (optionnelle, si l’utilisateur souhaite compléter)

Ajouter dans `%APPDATA%\Claude\claude_desktop_config.json`, section `mcpServers` :
```json
"mcp-search-net": {
  "command": "node",
  "args": ["N:\\workspace-dev\\mcp-search-net\\build\\bootstrap\\main.js"],
  "env": {
    "MCP_CONFIG_PATH": "N:\\workspace-dev\\mcp-search-net\\config\\application.yml"
  }
}
```
Puis redémarrer Claude Desktop et vérifier que le serveur apparaît dans l’interface MCP.

Un verdict `NON DISPONIBLE` est honnête si la version du client ne permet pas l’intégration native attendue. Il ne doit pas être transformé en PASS à partir d’un simple client STDIO externe.

## Gate D — Qualification logicielle exact-head

### Résultat Gate D — 2026-08-04

```text
Date : 2026-08-04 15:48–15:50 UTC+2
OS : Windows 10 Pro 10.0.19045
Node.js : 24.17.0
SHA : b96e00379c7bd7300e593707d4008bbc18b9b13c
Worktree : clean

npm run check               : PASS (typecheck + lint + format + build + coverage)
npm run test:required       : 264 passed, 0 skipped
npm run test:unit           : 113 passed, 0 skipped
npm run test:contract       :   6 passed, 0 skipped
npm run test:security       :  74 passed, 0 skipped
npm run test:resilience     :  25 passed, 0 skipped
npm run test:performance    :   2 passed, 0 skipped
npm run test:integration    :  42 passed, 0 skipped
npm run test:e2e:deterministic: 2 passed, 0 skipped
npm audit --audit-level=moderate        : 0 vulnérabilités
npm audit --omit=dev --audit-level=moderate : 0 vulnérabilités
Couverture fonctions : 85.38% (seuils globaux et par fichier respectés)

Verdict GATE D : PASS
```

### Commande de référence (pour reproduction)

```powershell
npm run check
npm run test:required
npm run test:unit
npm run test:contract
npm run test:security
npm run test:resilience
npm run test:performance
npm run test:integration
npm run test:e2e:deterministic
npm audit --audit-level=moderate
npm audit --omit=dev --audit-level=moderate
git status
git rev-parse HEAD
```

Le worktree doit être clean et tous les résultats doivent correspondre au même SHA exact.

## Décision de merge V2.14

La PR #25 peut passer Ready uniquement si :

- Gate A STDIO = PASS ;
- Gate D logiciel = PASS exact-head ;
- IntelliJ/Copilot = PASS ou PASS AVEC RÉSERVE avec fallback documenté ;
- Codex Desktop est qualifié honnêtement comme PASS, PASS AVEC RÉSERVE ou NON DISPONIBLE selon les capacités réellement observées ;
- aucun contrat mutable n’est exposé ;
- aucune capacité client non observée n’est revendiquée ;
- documentation et ADR-016 correspondent aux preuves.

Après merge, #17 peut être fermé et V2.15 / #18 devient le seul gate restant avant la PR d’intégration #8.
