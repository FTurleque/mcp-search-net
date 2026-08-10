# Registre de risques

> mcp-search-net v1.1.0 · 2026-08-08

Ce registre développe les risques résumés dans la [section 11](../arc42/11-risques-dette.md).

---

## Légende

| Probabilité | Valeur                                          |
| ----------- | ----------------------------------------------- |
| Haute       | > 50 % de survenance dans les 12 prochains mois |
| Moyenne     | 20–50 %                                         |
| Faible      | < 20 %                                          |

| Impact | Valeur                                                          |
| ------ | --------------------------------------------------------------- |
| Haut   | Blocage de la livraison ou régression de sécurité               |
| Moyen  | Dégradation de la qualité ou effort de remédiation significatif |
| Faible | Gêne mineure, contournable rapidement                           |

**Exposition** = Probabilité × Impact (Haute/Haute → Critique, etc.)

---

## R01 — Recall FTS5 insuffisant sur requêtes sémantiques

- **Probabilité** : Haute (mesuré : Recall@10 = 0 sur catégories paraphrase et multi-document)
- **Impact** : Moyen (le serveur reste fonctionnel ; les réponses sont simplement moins pertinentes)
- **Exposition** : Haute
- **Description** : Le moteur FTS5/BM25 ne trouve aucun résultat sur les requêtes formulées différemment des termes exacts du document. Constaté sur un corpus synthétique ; la situation réelle peut varier.
- **Mitigation actuelle** : ADR-018 autorise un prototype d'embeddings locaux ; baseline FTS5 documentée.
- **Mitigation complémentaire** : Démarrer le prototype vectoriel ; mesurer sur corpus de documentation réelle.
- **Propriétaire** : Auteur
- **Date de révision** : À définir (démarrage prototype)

---

## R02 — Migration Node.js LTS

- **Probabilité** : Moyenne (Node 24 entre en maintenance fin 2026, LTS support until 2028-04-30)
- **Impact** : Moyen (effort de migration, risque `better-sqlite3` prebuilds)
- **Exposition** : Moyenne
- **Description** : La contrainte `>=24 <25` bloque Node 26 explicitement. La migration nécessite des mises à jour de `package.json`, `runtime-guard.ts`, CI, Dockerfile et installateur Windows.
- **Mitigation actuelle** : Contrainte explicite ; `npm run check:runtime` bloquant en CI.
- **Mitigation complémentaire** : Planifier la migration avant la fin de la phase Active LTS de Node 24.
- **Propriétaire** : Auteur
- **Date cible** : 2026-Q4

---

## R03 — Dépendance `better-sqlite3` prebuilds N-API

- **Probabilité** : Faible (les prebuilds sont produits pour les plateformes courantes)
- **Impact** : Haut (la compilation par `node-gyp` est refusée ; plateforme non supportée = pas de serveur)
- **Exposition** : Moyenne
- **Description** : Si une nouvelle version de Node.js ou une plateforme non testée (ARM Windows, Linux musl) est utilisée, le prebuild peut manquer.
- **Mitigation actuelle** : `allowScripts: false` ; qualification dédiée `better-sqlite3@13.0.3`.
- **Mitigation complémentaire** : Vérifier les prebuilds disponibles avant toute migration Node ou plateforme.
- **Propriétaire** : Auteur
- **Date cible** : Continu

---

## R04 — Vulnérabilité CVE dans image Docker figée

- **Probabilité** : Faible (images récentes, digests vérifiés)
- **Impact** : Haut (CVE critique dans SearXNG ou Crawl4AI imposerait un update d'urgence)
- **Exposition** : Moyenne
- **Description** : Les images sont figées par digest SHA-256 pour garantir la reproductibilité. En cas de vulnérabilité critique, un update manuel est requis, ce qui rompt le gel.
- **Mitigation actuelle** : `check:supply-chain` en CI ; veille CVE.
- **Mitigation complémentaire** : Documenter le processus de mise à jour d'urgence (nouveau digest → commit → CI → release).
- **Propriétaire** : Auteur
- **Date cible** : Continu

---

## R05 — Certification native des clients MCP non terminée

- **Probabilité** : Moyenne (issue #34 ouverte)
- **Impact** : Moyen (le contrat est documenté et partiellement testé ; l'observation réelle manque pour 5 clients)
- **Exposition** : Moyenne
- **Description** : IntelliJ/Copilot, Claude Desktop/Code, Codex Desktop et Copilot CLI n'ont pas tous été certifiés par observation directe. La sonde STDIO prouve le contrat serveur mais pas la compatibilité client.
- **Mitigation actuelle** : Cinq outils restent le contrat portable principal ; resources/templates complémentaires.
- **Mitigation complémentaire** : Terminer l'issue #34 avec preuves client réelles.
- **Propriétaire** : Auteur
- **Date cible** : Non planifié

---

## R06 — Vulnérabilité future dans `pdfjs-dist`

- **Probabilité** : Moyenne (historique : GHSA-hq66-cqwq-w95j déjà rencontré)
- **Impact** : Haut (exécution de JavaScript arbitraire sur PDF malveillant)
- **Exposition** : Haute
- **Description** : `pdfjs-dist` est exposé à du contenu PDF externe non fiable. La bibliothèque est activement développée et les CVE passées montrent un risque réel.
- **Mitigation actuelle** : Épinglé à `6.2.108` (hors plage CVE connue) ; `npm audit` en CI.
- **Mitigation complémentaire** : Mise à jour réactive sur toute future CVE dans `pdfjs-dist`.
- **Propriétaire** : Auteur
- **Date cible** : Continu

---

## R07 — Fuite réseau via Crawl4AI (mode hybride)

- **Probabilité** : Faible (architecture défensive)
- **Impact** : Haut (Playwright Chromium + relais loopback = surface d'attaque potentielle)
- **Exposition** : Moyenne
- **Description** : En mode hybride, `crawl4ai-loopback` expose Crawl4AI sur `127.0.0.1:11235`. Une faille Playwright exploitable par un document HTML malveillant pourrait atteindre le réseau hôte.
- **Mitigation actuelle** : HTML neutralisé avant envoi à Crawl4AI ; Crawl4AI confiné au réseau `backend` ; pas d'egress direct.
- **Mitigation complémentaire** : Surveiller les CVE Playwright/Chromium ; envisager le mode Docker pur (sans overlay hybride) en environnement sensible.
- **Propriétaire** : Auteur
- **Date cible** : Continu
