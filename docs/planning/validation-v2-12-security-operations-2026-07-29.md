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

## Erratum et supersession — audit du 29 juillet 2026

Les résultats ci-dessus constituent une **preuve historique** du candidat
`131d12fb4d2cf03937c24a7106bfcd758cd0c368`. Ils ne qualifient pas les commits
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
  cryptographiquement aléatoire sans sink filesystem JavaScript piloté par une
  variable d'environnement ;
- les tokens de développement connus ne sont plus stockés en clair dans le code
  runtime chargé de les refuser hors profil `development`.

Après ces corrections, SonarQube Cloud a annoncé **Quality Gate passed**, avec
**0 Security Hotspots**, sur le candidat runtime/documentation antérieur à cette
réconciliation documentaire (`4a36fe97925d8e6d13486434a3feb2d31a186513`).
Cette preuve Sonar ne remplace pas les gates locaux.

### Qualification encore requise

Le connecteur GitHub ne fournit pas de runner Windows local. Aucune commande
locale n'a donc été rejouée sur le head issu de ces corrections et aucun workflow
GitHub Actions n'a été déclenché.

Avant merge de #23, exécuter sur le **SHA exact final** de la branche :

```text
npm run check
npm run test:required
npm run test:unit
npm run test:contract
npm run test:security
npm run test:resilience
npm run test:performance
npm run test:integration
npm run test:e2e:deterministic
scripts/test-node-runtime-integrity.ps1
scripts/test-installation.ps1 -NodeRuntimeSource <Node-24-root>
npm audit --audit-level=moderate
npm audit --omit=dev --audit-level=moderate
```

Puis enregistrer les sorties exactes, le SHA qualifié et le verdict dans cette
preuve, dans la PR #23 et dans l'issue #15. Tant que cette étape n'est pas faite,
#23 reste en **draft** et #15 reste **ouverte**.
