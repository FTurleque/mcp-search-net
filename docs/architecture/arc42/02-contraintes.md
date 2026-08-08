# Section 2 — Contraintes

> arc42 · mcp-search-net v1.1.0 · 2026-08-08

---

## 2.1 Contraintes techniques

| ID | Contrainte | Type | Source |
|---|---|---|---|
| CT-01 | Le runtime est **Node.js 24 LTS** exactement (`>=24 <25`). Node 22 et Node 26 sont refusés par `runtime-guard.ts`. | **Imposée** | `package.json` / ADR-001 |
| CT-02 | Le transport MCP est **STDIO uniquement**. Le processus n'ouvre aucun port réseau applicatif. | **Imposée** | ADR-002 |
| CT-03 | `stdout` est réservé au JSON-RPC MCP. Tout log, diagnostic et trace va sur `stderr`. | **Imposée** | ADR-002 / contrat MCP |
| CT-04 | Le langage de développement est **TypeScript strict** (`strict: true`, `exactOptionalPropertyTypes: true`, `noEmitOnError: true`). | **Imposée** | ADR-001 |
| CT-05 | Le module système est **ESM NodeNext** ; pas de CommonJS. | **Imposée** | `tsconfig.build.json` |
| CT-06 | La dépendance SQLite native `better-sqlite3@13.0.3` utilise les **prebuilds N-API** ; la compilation par `node-gyp` est refusée par `allowScripts`. | **Imposée** | `package.json` / `docs/status/current-state.md` |
| CT-07 | Le build produit un artefact dans `build/` uniquement ; pas de compilation incrémentale en production. | **Imposée** | `tsconfig.build.json` |
| CT-08 | La version `@modelcontextprotocol/sdk` est **épinglée exactement** (`1.30.0`). | **Imposée** | ADR-012 / ADR-013 |

---

## 2.2 Contraintes de sécurité

| ID | Contrainte | Type | Source |
|---|---|---|---|
| CS-01 | Seuls les protocoles **HTTP et HTTPS** sont acceptés pour les URLs entrantes. | **Imposée** | ADR-009 |
| CS-02 | Les plages IP privées, loopback, link-local, CGNAT, multicast et documentation sont **bloquées avant connexion et après chaque redirection**. | **Imposée** | ADR-009 / `public-url-security-policy.ts` |
| CS-03 | Maximum **5 redirections**, **10 Mo** de téléchargement, **20 secondes** de timeout et **4 connexions simultanées** par défaut. Ces limites sont des constantes non configurables par l'appelant. | **Imposée** | `application-config.ts` / ADR-008 |
| CS-04 | **`robots.txt`** est respecté avec support des jokers `*`, ancre `$` et priorité `Allow`. | **Imposée** | `secure-http-gateway.ts` |
| CS-05 | Crawl4AI reçoit uniquement un document `raw://` **neutralisé** — jamais l'URL publique. Les attributs de chargement de ressources et les éléments actifs sont supprimés avant transport. | **Imposée** | ADR-005 / `prepared-html-sanitizer.ts` |
| CS-06 | Les **stack traces, messages internes et secrets** ne sont jamais renvoyés dans les réponses MCP. | **Imposée** | `tool-call.ts` / `domain-errors.ts` |
| CS-07 | Le profil `production` interdit HTTP non sécurisé (`allowHttp: false`). | **Imposée** | `application-config.ts` |

---

## 2.3 Contraintes organisationnelles

| ID | Contrainte | Type | Source |
|---|---|---|---|
| CO-01 | **Licence propriétaire** source-available. Aucune API commerciale ni dépendance copyleft dans le runtime. | **Imposée** | `LICENSE` / `check:license` |
| CO-02 | La supply chain npm est vérifiée par `check:supply-chain` et `npm audit`. Les images Docker sont figées par **digest SHA-256**. | **Imposée** | `scripts/check-supply-chain.mjs` / `compose.yaml` |
| CO-03 | Un candidat de release n'est qualifié que si les checks CI réussissent sur le **SHA exact** du candidat, pas sur un SHA antérieur. | **Imposée** | `docs/status/current-state.md` |
| CO-04 | Les migrations SQL sont **immuables** une fois appliquées. Toute évolution crée une nouvelle migration. | **Imposée** | ADR-014 / `catalog-migration-runner.ts` |

---

## 2.4 Préférences (non imposées)

| ID | Préférence | Justification |
|---|---|---|
| CP-01 | Aucun LLM ni embedding dans le runtime V1.x | Reproductibilité, absence de quota IA (ADR-007, ADR-018) |
| CP-02 | Architecture hexagonale | Testabilité et remplacement des adaptateurs (ADR-003) |
| CP-03 | Deux bases SQLite séparées (`cache.sqlite` / `catalog.db`) | Isolation fonctionnelle, suppression du cache sans perte du catalogue (ADR-014) |
