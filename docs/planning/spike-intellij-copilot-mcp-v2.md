# Spike IntelliJ/Copilot — MCP V2 documentaire

## Statut

- **Nature** : recette de qualification client, préparée historiquement le 2026-07-05.
- **Candidat courant** : `1.1.0`, non publié et non qualifié pour la production.
- **État** : recette à rejouer sur le SHA final depuis IntelliJ IDEA + GitHub Copilot ; Codex Desktop peut servir de client complémentaire.
- **Source d'autorité courante** : [état technique du checkout](../status/current-state.md).
- **Portée de la preuve** : une exécution locale de ce spike ne prouve ni GitHub Actions ni un autre SHA. La CI reste un gate séparé à exécuter sur le candidat exact.

La branche `feat/v2-catalog-storage` et la PR draft #8 appartenaient au contexte de préparation du
5 juillet 2026 ; elles ne décrivent pas automatiquement le statut du checkout courant.

## Objectif

Valider que l'ergonomie V2 est exploitable depuis IntelliJ/GitHub Copilot sans exposer d'opération
mutable au LLM.

Le spike doit répondre à quatre questions :

1. Copilot détecte-t-il exactement les cinq outils `search_web`, `fetch_url`, `search_docs`, `list_docs` et `read_doc_section` ?
2. Le workflow compact `search_docs` → sélection de 1 à 3 résultats → `read_doc_section` est-il naturel et borné ?
3. Copilot expose-t-il ou exploite-t-il les quatre resources statiques et les neuf resource templates read-only du catalogue V2 ?
4. Les trois outils documentaires fournissent-ils un fallback complet si le client ne permet pas de lire directement les resources MCP ?

Codex Desktop peut aussi être utilisé comme client de validation complémentaire : il permet de
préparer le catalogue local, d'exécuter les commandes de contrôle et de tester le workflow
`search_docs` → `read_doc_section`.

## Périmètre validé côté serveur

Le serveur V2 expose actuellement :

- outil V1 `search_web` ;
- outil V1 `fetch_url` ;
- outil V2 `search_docs` ;
- outil V2 `list_docs` ;
- outil V2 `read_doc_section` ;
- resource statique `mcp-search-net://catalog` ;
- resource statique `mcp-search-net://sources` ;
- resource statique `mcp-search-net://documents` ;
- resource statique `mcp-search-net://sections` ;
- template `mcp-search-net://sources/page/{offset}` ;
- template `mcp-search-net://sources/{sourceId}` ;
- template `mcp-search-net://documents/page/{offset}` ;
- template `mcp-search-net://documents/{documentId}` ;
- template `mcp-search-net://documents/{documentId}/versions` ;
- template `mcp-search-net://documents/{documentId}/versions/page/{offset}` ;
- template `mcp-search-net://documents/{documentId}/versions/{versionId}` ;
- template `mcp-search-net://sections/page/{offset}` ;
- template `mcp-search-net://sections/{sectionId}`.

Toutes les resources retournent du JSON `application/json` et restent read-only.

## Préparation locale du spike

Depuis le checkout candidat à qualifier :

```powershell
npm ci
npm run build
```

Créer un catalogue de spike séparé pour ne pas polluer le catalogue de travail :

```powershell
$env:MCP_CATALOG_PATH = ".data/catalog-spike.db"
npm run catalog -- init --path .data/catalog-spike.db
npm run catalog -- add-source `
  --path .data/catalog-spike.db `
  --key local-v2-docs `
  --name "Documentation locale V2" `
  --base-url "https://local.mcp-search-net/docs" `
  --type documentation `
  --language fr `
  --freshness manual `
  --sync manual
```

Indexer au moins dix documents Markdown locaux pour obtenir un corpus représentatif :

```powershell
$docs = @(
  @{ File = "README.md"; Url = "https://local.mcp-search-net/README.md"; Title = "README"; Key = "readme" },
  @{ File = "docs/README.md"; Url = "https://local.mcp-search-net/docs/README.md"; Title = "Documentation index"; Key = "docs-index" },
  @{ File = "docs/getting-started/intellij-copilot.md"; Url = "https://local.mcp-search-net/docs/getting-started/intellij-copilot"; Title = "IntelliJ Copilot"; Key = "intellij-copilot" },
  @{ File = "docs/getting-started/usage.md"; Url = "https://local.mcp-search-net/docs/getting-started/usage"; Title = "Usage MCP"; Key = "usage" },
  @{ File = "docs/reference/tools.md"; Url = "https://local.mcp-search-net/docs/reference/tools"; Title = "Contrats outils"; Key = "tools" },
  @{ File = "docs/reference/catalog-schema-v2.md"; Url = "https://local.mcp-search-net/docs/reference/catalog-schema-v2"; Title = "Schéma catalogue V2"; Key = "catalog-schema-v2" },
  @{ File = "docs/reference/catalog-sync-v2.md"; Url = "https://local.mcp-search-net/docs/reference/catalog-sync-v2"; Title = "Synchronisation V2"; Key = "catalog-sync-v2" },
  @{ File = "docs/planning/roadmap-v2-documentaire.md"; Url = "https://local.mcp-search-net/docs/planning/roadmap-v2-documentaire"; Title = "Roadmap V2"; Key = "roadmap-v2" },
  @{ File = "docs/planning/benchmark-v2.md"; Url = "https://local.mcp-search-net/docs/planning/benchmark-v2"; Title = "Benchmark V2"; Key = "benchmark-v2" },
  @{ File = "docs/adr/ADR-016-mcp-v2-tools-resources.md"; Url = "https://local.mcp-search-net/docs/adr/ADR-016"; Title = "ADR-016 MCP V2"; Key = "adr-016" }
)

foreach ($doc in $docs) {
  npm run catalog -- ingest-text `
    --path .data/catalog-spike.db `
    --source-key local-v2-docs `
    --file $doc.File `
    --url $doc.Url `
    --title $doc.Title `
    --stable-key $doc.Key `
    --language fr `
    --mime-type text/markdown `
    --version-label "spike-2026-07-05"
}
```

Reconstruire l'index et vérifier le catalogue :

```powershell
npm run catalog -- rebuild-index --path .data/catalog-spike.db
npm run catalog -- verify --path .data/catalog-spike.db
npm run catalog -- status --path .data/catalog-spike.db
npm run catalog -- search --path .data/catalog-spike.db --query "resources MCP V2" --limit 5
```

Le statut attendu contient au moins `documentCount: 10`.

## Configuration Copilot à utiliser pour le spike

Le serveur lancé par Copilot doit pointer vers le catalogue de spike.

Dans `~/.copilot/mcp-config.json`, déclarer le serveur sous la racine officielle `mcpServers` et
ajouter ou remplacer la variable de catalogue :

```json
{
  "mcpServers": {
    "mcp-search-net": {
      "type": "local",
      "command": "cmd.exe",
      "args": [
        "/d",
        "/s",
        "/c",
        "C:\\Users\\<utilisateur>\\AppData\\Local\\mcp-search-net\\bin\\mcp-search-net.cmd"
      ],
      "env": {
        "MCP_CATALOG_PATH": "N:/chemin/vers/mcp-search-net/.data/catalog-spike.db"
      },
      "tools": ["*"]
    }
  }
}
```

Adapter le chemin Windows au poste local. Redémarrer le serveur MCP depuis l'interface Copilot après modification.

## Variante Codex Desktop

Codex Desktop peut être utilisé pour lancer la préparation locale et tester le serveur MCP V2.

### Préparation depuis Codex

Ouvrir le dossier local du repo dans Codex Desktop, puis demander à Codex :

```text
Prépare le spike MCP V2 sur le checkout courant : exécute npm ci et npm run build, puis suis la section "Préparation locale du spike" de docs/planning/spike-intellij-copilot-mcp-v2.md pour créer .data/catalog-spike.db et indexer les 10 documents locaux. N'effectue aucune opération Git ou GitHub.
```

Sous Windows, Codex doit utiliser PowerShell ou l'environnement terminal configuré dans l'application. Si PowerShell bloque `npm.ps1`, corriger la politique d'exécution localement ou lancer les commandes via `cmd.exe`.

### Déclaration MCP dans Codex

Codex lit les serveurs MCP depuis `~/.codex/config.toml` ou depuis `.codex/config.toml` pour un projet de confiance. Pour tester `mcp-search-net` depuis Codex Desktop, ajouter une configuration de ce type en adaptant les chemins :

```toml
[mcp_servers.mcp-search-net]
command = "cmd.exe"
args = [
  "/d",
  "/s",
  "/c",
  "N:\\chemin\\vers\\mcp-search-net\\scripts\\intellij\\run-local-mcp.cmd"
]
cwd = "N:\\chemin\\vers\\mcp-search-net"
startup_timeout_sec = 20
tool_timeout_sec = 60
default_tools_approval_mode = "prompt"
enabled = true

[mcp_servers.mcp-search-net.env]
MCP_CONFIG_PATH = "N:\\chemin\\vers\\mcp-search-net\\config\\application.yml"
MCP_CATALOG_PATH = "N:\\chemin\\vers\\mcp-search-net\\.data\\catalog-spike.db"
MCP_CRAWL4AI_TOKEN = "votre-jeton-local"
```

Si le serveur installé dans `%LOCALAPPDATA%` est préféré, remplacer `args` par le chemin vers `%LOCALAPPDATA%\\mcp-search-net\\bin\\mcp-search-net.cmd`.

### Scénarios Codex

Dans un thread Codex ouvert sur le repo, demander :

```text
Liste les serveurs MCP disponibles et vérifie que mcp-search-net expose exactement search_web, fetch_url, search_docs, list_docs et read_doc_section.
```

Puis :

```text
Utilise search_docs avec au plus 3 résultats pour chercher "resources MCP V2" dans le catalogue local, choisis la section la plus pertinente, puis appelle read_doc_section uniquement pour cette section. Utilise list_docs séparément pour vérifier que le catalogue contient au moins 10 documents.
```

Résultat attendu :

- Codex voit le serveur `mcp-search-net` ;
- les cinq outils sont visibles et les trois outils documentaires sont utilisables ;
- `search_docs` renvoie 1 à 3 résultats, puis `read_doc_section` lit seulement la section choisie ;
- les résultats proviennent de `.data/catalog-spike.db` ;
- aucune commande mutable MCP n'est nécessaire.

Les resources MCP peuvent ne pas être exposées comme surface utilisateur directe selon le client
Codex. Dans ce cas, le résultat reste acceptable si `search_docs`, `list_docs` et
`read_doc_section` couvrent le besoin documentaire.

## Scénarios de recette Copilot

### S1 — Contrat final à cinq outils

Demander à Copilot :

```text
Liste les outils MCP mcp-search-net disponibles et confirme que seuls search_web, fetch_url, search_docs, list_docs et read_doc_section sont exposés.
```

Résultat attendu :

- les cinq outils attendus sont visibles ;
- aucun outil mutable ou sixième outil n'est exposé ;
- les outils V1 `search_web` et `fetch_url` restent disponibles.

### S2 — Workflow documentaire compact

Demander à Copilot :

```text
Utilise search_docs avec maxResults 3 pour chercher "resources MCP V2" dans le catalogue local. Choisis ensuite la section la plus pertinente et utilise read_doc_section uniquement pour cette section.
```

Résultat attendu :

- Copilot appelle `search_docs`, retient de 1 à 3 résultats, puis appelle `read_doc_section` ;
- la réponse cite des documents locaux du corpus de spike ;
- le contenu complet ne vient que de la section explicitement choisie.

### S3 — Lecture résumé catalogue

Demander à Copilot :

```text
Lis la resource MCP mcp-search-net://catalog si elle est disponible et résume les compteurs du catalogue.
```

Résultat attendu idéal :

- Copilot lit la resource ;
- le JSON contient `schemaVersion`, `resources` et `counts` ;
- `counts.documents` est au moins égal à 10.

Résultat acceptable si Copilot ne supporte pas encore les resources :

- Copilot indique que la lecture directe de resource n'est pas disponible ;
- le fallback par `search_docs`, `list_docs` et `read_doc_section` reste utilisable.

### S4 — Navigation documents et sections

Demander à Copilot :

```text
Utilise list_docs pour parcourir les métadonnées du catalogue. Pour expliquer la synchronisation V2, utilise ensuite search_docs avec au plus 3 résultats puis read_doc_section sur une seule section choisie.
```

Résultat attendu :

- Copilot réserve `list_docs` au parcours des métadonnées et utilise `search_docs` puis `read_doc_section` pour la question de contenu ;
- les résultats proviennent du corpus local ;
- aucune recherche Web n'est nécessaire.

### S5 — Versions documentaires

Demander à Copilot :

```text
Si les resources MCP sont accessibles, lis les versions d'un document du catalogue et explique quel champ indique la version courante.
```

Résultat attendu idéal :

- Copilot lit `mcp-search-net://documents/{documentId}/versions` ;
- la réponse mentionne `isCurrent` ou `currentVersionId`.

Résultat acceptable :

- Copilot n'expose pas les templates dynamiques, mais les trois outils documentaires restent fonctionnels.

## Critères de décision

Le spike est **GO** si :

- exactement cinq outils sont visibles : `search_web`, `fetch_url`, `search_docs`, `list_docs` et `read_doc_section` ;
- le workflow borné `search_docs` → sélection de 1 à 3 résultats → `read_doc_section` répond correctement sur le catalogue local ;
- les quatre resources statiques et neuf templates sont lisibles depuis Copilot, ou le fallback par les trois outils documentaires est clair et fonctionnel ;
- aucune opération mutable n'est exposée par MCP ;
- les logs ne polluent pas `stdout`.

Le spike est **GO avec réserve** si :

- Copilot utilise correctement les trois outils documentaires, mais ne sait pas encore lire les resources MCP ;
- la documentation utilisateur explique clairement cette limite ;
- le contrat serveur reste stable et couvert par E2E.

Le spike est **NO-GO** si :

- Copilot ne voit pas l'un des cinq outils ou expose un outil inattendu ;
- le workflow `search_docs` → `read_doc_section` est inutilisable ;
- le serveur ne démarre pas via la configuration utilisateur ;
- le catalogue V2 est vide ou illisible ;
- l'usage depuis Copilot nécessite une opération mutable MCP.

Pour Codex Desktop, appliquer la même décision, mais considérer les trois outils documentaires comme
surface principale si les resources MCP ne sont pas affichées directement par le client.

## Preuves à archiver après exécution

Créer un document de validation daté, par exemple :

```text
docs/planning/validation-intellij-copilot-mcp-v2-YYYY-MM-DD.md
```

Contenu minimal :

- client utilisé : IntelliJ/Copilot ou Codex Desktop ;
- version IntelliJ IDEA, version du plugin GitHub Copilot ou version Codex Desktop ;
- version Node.js ;
- commit testé ;
- chemin de catalogue utilisé ;
- résultat de `catalog status` ;
- résultat de `catalog verify` ;
- transcript ou capture des scénarios S1 à S5 ou des scénarios Codex ;
- décision GO / GO avec réserve / NO-GO ;
- limites observées côté client MCP.

## Impacts selon résultat

- **GO** : cocher le spike dans la roadmap V2 et considérer AC-V2-04 validable après revalidation locale/CI.
- **GO avec réserve** : conserver `search_docs`, `list_docs` et `read_doc_section` comme surface utilisateur principale et documenter les resources comme contrat serveur read-only.
- **NO-GO** : corriger le contrat, la configuration client ou le workflow compact, puis rejouer la qualification sur le même candidat sans introduire de mutation MCP.
