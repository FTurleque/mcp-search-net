# Validation locale V2.12 — sécurité, installation et exploitation

## Périmètre

- Branche focalisée : `fix/v2-12-security-operations`.
- Base d'agrégation au démarrage : `f26144071510c6838dc64a64b63117160feef722`.
- Issue : #15.
- GitHub Actions : non déclenchées conformément à la restriction de quota.

## Résultat fonctionnel

- Les succès MCP et resources JSON portent
  `EXTERNAL_UNTRUSTED_CONTENT`; les instructions de page restent du texte.
- `search_web` expose provider et instant réel de récupération ; `fetch_url`
  conserve URL demandée, finale, canonique, statut et instant réel.
- L'installateur épingle le SHA-256 officiel de Node 24.17.0, vérifie avant
  extraction, exige la signature OpenJS et écrit un manifeste de preuve.
- Les profils `development`, `test`, `production` sont explicites ; les jetons
  d'exemple connus sont refusés hors développement et Compose n'a plus de secret
  implicite.
- Le lock de maintenance utilise token, PID, hostname, heartbeat séparé,
  liveness et récupération stale par quarantaine sans écraser un nouveau
  propriétaire.
- `catalog health` et `catalog backup` couvrent intégrité, snapshot en ligne,
  SHA-256, refus d'écrasement et restauration documentée.
- SDK MCP, transitives, chaîne ESLint et images OCI sont verrouillés ; licences
  et digests sont contrôlés hors ligne.

## Gates déterministes

Runtime : Node.js `24.17.0`.

```text
npm run check
REQUIRED_SUITE_VALID coverage: 214 passed, 0 skipped
Statements 77.82% | Branches 64.42% | Functions 84.10% | Lines 80.36%
```

Le gate comprend runtime, configuration Copilot, supply chain, Prettier, ESLint,
typecheck, build et couverture. L'architecture reste conforme : aucun import
`infrastructure` depuis `src/domain`.

## Installation et supply chain

```text
scripts/test-node-runtime-integrity.ps1
NODE_RUNTIME_INTEGRITY_VALID

scripts/test-installation.ps1 -NodeRuntimeSource <Node-24-root>
INSTALLATION_LIFECYCLE_VALID

npm audit --audit-level=moderate
found 0 vulnerabilities

npm audit --omit=dev --audit-level=moderate
found 0 vulnerabilities
```

La recette Windows PowerShell 5.1 s'exécute depuis une copie temporaire pour ne
pas perturber un serveur MCP actif. Elle valide installation propre,
réinstallation, conservation de configuration/données/secrets, package de
production, désinstallation `-KeepData`, puis désinstallation complète. Le vrai
wrapper CMD charge aussi le token généré dans un test comportemental.

## Docker local

`docker compose config --quiet` passe avec deux secrets éphémères limités au
processus. Aucun service existant n'a été démarré, arrêté ou supprimé.

```text
docker build --pull --tag mcp-search-net:v2.12-validation .
Node base digest: sha256:862263c612aa437e3037674b85419622a9d93bff80aa1eee5398dfe686375532
build npm ci: 280 packages, 0 vulnerabilities
runtime npm ci --omit=dev: 132 packages, 0 vulnerabilities
local manifest list: sha256:523c0f78f2f460b493709c3b6112208bb73fab85a6e43f9d65d054f574af155e
```

L'image de validation reste locale ; aucune suppression Docker n'a été effectuée
sans autorisation distincte.

## Réserves

- Les tests live SearXNG/Crawl4AI ne sont pas un gate spécifique de V2.12 et
  n'ont pas été rejoués à cette étape ; ils restent requis par la qualification
  finale #18.
- La validation exact-head de la branche et du merge d'agrégation doit être
  enregistrée dans le PR focalisé et l'issue avant clôture.
