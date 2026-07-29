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

## Gates déterministes historiques

Runtime : Node.js `24.17.0`.

```text
npm run check
REQUIRED_SUITE_VALID coverage: 214 passed, 0 skipped
Statements 77.82% | Branches 64.42% | Functions 84.10% | Lines 80.36%
```

Le gate comprend runtime, configuration Copilot, supply chain, Prettier, ESLint,
typecheck, build et couverture. L'architecture reste conforme : aucun import
`infrastructure` depuis `src/domain`.

## Installation et supply chain historiques

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

## Docker local historique

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

## Erratum et supersession — audit du 29 juillet 2026

Les résultats historiques ci-dessus qualifiaient le candidat
`131d12fb4d2cf03937c24a7106bfcd758cd0c368`. Ils ne qualifiaient pas les commits
postérieurs ajoutés pendant l'audit de reprise.

L'audit a identifié puis corrigé les écarts suivants :

- PR #23 retargetée de `master` vers `feat/v2-catalog-storage` afin de conserver
  une tranche V2.12 focalisée ;
- signature Authenticode OpenJS de `node.exe` vérifiée avant toute exécution du
  runtime déjà présent ou fraîchement extrait ;
- recette Windows enrichie d'un échec d'activation volontaire démontrant la
  restauration réelle de l'installation précédente ;
- résultat `busy` de `PRAGMA wal_checkpoint(TRUNCATE)` désormais contrôlé, avec
  échec explicite au lieu de déclarer `walCheckpointed: true` à tort ;
- test SQLite avec lecteur concurrent couvrant ce checkpoint bloqué ;
- `catalog health` et `catalog status` utilisent les compteurs SQL plutôt que de
  charger toutes les sources et tous les documents ;
- `catalog backup` confine les snapshots dans `backups/` adjacent au catalogue
  et valide strictement le nom publié ;
- les chemins de manifests du contrôle supply-chain sont bornés sous
  `node_modules` ;
- un `ownerToken` relu depuis les métadonnées de lock ne participe plus au nom du
  fichier de quarantaine ;
- le fixture multi-processus ne reçoit plus de chemins filesystem via
  `process.argv` ;
- les secrets éphémères du workflow manuel sont générés avec une source
  cryptographiquement aléatoire ;
- les tokens de développement connus ne sont plus stockés en clair dans le code
  runtime chargé de les refuser hors profil `development`.

SonarQube Cloud a ensuite annoncé **Quality Gate passed** avec
**0 Security Hotspots** sur la PR #23. Cette preuve Sonar ne remplace pas les
gates locaux.

## Qualification locale exact-head finale

Qualification exécutée sous Windows sur le SHA exact :

```text
4651ccae3315e4b64e1bd42e1274fa9eed34a83f
```

État Git avant exécution : branche `fix/v2-12-security-operations` synchronisée
avec `origin`, working tree clean.

### Gate global

```text
npm run check
Node.js runtime validated: 24.17.0
SUPPLY_CHAIN_CHECK_PASSED
Prettier: PASS
ESLint: PASS
typecheck: PASS
build: PASS
REQUIRED_SUITE_VALID coverage: 216 passed, 0 skipped
Statements 78.03% | Branches 64.51% | Functions 84.18% | Lines 80.55%
```

Le contrôle supply-chain a validé le SDK MCP `1.30.0`, les overrides attendus,
4 références OCI pinées par digest et 132 paquets de production avec licences
admises.

### Suites obligatoires

```text
npm run test:required
REQUIRED_SUITE_VALID required: 216 passed, 0 skipped

npm run test:unit
REQUIRED_SUITE_VALID unit: 95 passed, 0 skipped

npm run test:contract
REQUIRED_SUITE_VALID contract: 6 passed, 0 skipped

npm run test:security
REQUIRED_SUITE_VALID security: 68 passed, 0 skipped

npm run test:resilience
REQUIRED_SUITE_VALID resilience: 25 passed, 0 skipped

npm run test:performance
REQUIRED_SUITE_VALID performance: 2 passed, 0 skipped

npm run test:integration
REQUIRED_SUITE_VALID integration: 35 passed, 0 skipped

npm run test:e2e:deterministic
2 passed, 0 failed
```

Le test E2E STDIO confirme les outils V1/V2 attendus et le maintien de `stdout`
en JSON-RPC avec diagnostics structurés uniquement sur `stderr`.

### Windows, installation et rollback

```text
scripts/test-node-runtime-integrity.ps1
NODE_RUNTIME_INTEGRITY_VALID: valid checksum accepted; invalid checksum rejected.

scripts/test-installation.ps1 -NodeRuntimeSource <Node-24-root>
INSTALLATION_LIFECYCLE_VALID
```

La recette a observé un échec d'activation volontaire
`MCP_INSTALL_TEST_ACTIVATION_FAILURE`, a restauré l'installation précédente,
puis a poursuivi avec succès le cycle de mise à jour, conservation des données,
désinstallation partielle, réinstallation et désinstallation complète.

Pendant la recette :

- installation développement : 280 paquets, 0 vulnérabilité ;
- installation production : 132 paquets, 0 vulnérabilité.

### Audits npm

```text
npm audit --audit-level=moderate
found 0 vulnerabilities

npm audit --omit=dev --audit-level=moderate
found 0 vulnerabilities
```

## Merge V2.12

PR #23 mergée dans `feat/v2-catalog-storage` :

```text
head qualifié : 4651ccae3315e4b64e1bd42e1274fa9eed34a83f
merge commit  : 64622e6e40f3ad18bc5c2a867a5600f19bf2d25c
```

La comparaison GitHub entre le head qualifié et le merge commit retourne
`files: []` : le merge n'a introduit aucun changement de contenu. Le tree intégré
est donc équivalent au tree exact-head qualifié.

## Verdict

**V2.12 — PASS / MERGED.**

L'issue #15 peut être clôturée. Les tests live SearXNG/Crawl4AI restent hors du
gate spécifique V2.12 et seront rejoués dans la qualification finale #18. Aucun
workflow GitHub Actions n'a été déclenché pendant cette qualification.
