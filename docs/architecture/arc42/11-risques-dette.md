# Section 11 — Risques et dette technique

> arc42 · mcp-search-net v1.1.0 · 2026-08-10

Le registre complet se trouve dans [`../risks/register.md`](../risks/register.md).

---

## 11.1 Risques priorisés

| ID  | Risque                                                                                                                                           | Probabilité    | Impact | Exposition | Mitigation                                                                                                             | Propriétaire | Date cible            |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------ | -------------- | ------ | ---------- | ---------------------------------------------------------------------------------------------------------------------- | ------------ | --------------------- |
| R01 | **Recall FTS5/BM25 insuffisant** sur paraphrases et requêtes multi-document (Recall@10 = 0 sur ces catégories)                                   | Haute (mesuré) | Moyen  | Haute      | Prototype embeddings locaux autorisé (ADR-018) ; FTS reste la baseline produit                                         | Auteur       | À définir (prototype) |
| R02 | **Migration Node.js LTS** : Node 24 entre en maintenance fin 2026, migration vers Node 26 LTS à planifier                                        | Moyenne        | Moyen  | Moyenne    | Constraint `>=24 <25` dans `package.json` ; garde `runtime-guard.ts` ; surveiller le cycle LTS                         | Auteur       | 2026-Q4               |
| R03 | **Dépendance `better-sqlite3`** : pré-builds N-API figés ; une nouvelle plateforme ou version Node rompt la livraison si le prebuild manque      | Faible         | Haut   | Moyenne    | `allowScripts: false` ; qualification dédiée par plateforme (docs/planning/validation-better-sqlite3-13-2026-08-07.md) | Auteur       | Continu               |
| R04 | **Digest Docker SearXNG/Crawl4AI obsolètes** : une vulnérabilité CVE critique dans une image figée impose un update d'urgence                    | Faible         | Haut   | Moyenne    | `check:supply-chain` en CI ; veille CVE active                                                                         | Auteur       | Continu               |
| R05 | **Requalification native des clients MCP** après changement de client, OS ou SHA serveur                                                         | Faible         | Moyen  | Faible     | Certification 3/3 terminée le 10 août 2026 ; preuves liées aux versions et au SHA observés ; sonde STDIO automatisée   | Auteur       | À chaque évolution    |
| R06 | **`pdfjs-dist` future vulnérabilité** : déjà affecté une fois (`GHSA-hq66-cqwq-w95j`) ; bibliothèque active et exposée au contenu externe        | Moyenne        | Haut   | Haute      | Épinglé à `6.2.108` ; `npm audit` en CI ; mise à jour réactive                                                         | Auteur       | Continu               |
| R07 | **Isolation Crawl4AI insuffisante** : mode hybride expose Crawl4AI via relais loopback ; une faille Playwright pourrait atteindre le réseau hôte | Faible         | Haut   | Moyenne    | Réseau `backend` interne Docker ; relais minimal Node.js sans droits ; mode Docker pur ne publie pas Crawl4AI          | Auteur       | Continu               |

---

## 11.2 Dette technique

| ID  | Dette                                                                                                                                                                                     | Impact | Effort d'élimination | Priorité                       |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | -------------------- | ------------------------------ |
| D01 | **`addDocumentVersion` / `replaceDocumentSections` dépréciées** dans `CatalogRepository` : maintenues pour compatibilité interne CLI mais `commitDocumentRevision` est l'API de référence | Faible | Faible               | Basse (nettoyage opportuniste) |
| D02 | **Requalification native non automatisable de bout en bout** : la certification 3/3 est terminée, mais une nouvelle version cliente ou serveur exige une observation native datée          | Faible | Moyen                | Basse                          |
| D03 | **Prototype vectoriel local non démarré** : ADR-018 l'autorise mais la preuve de persistance, packaging et offline reste à produire                                                       | Moyen  | Haut                 | Basse (travaux futurs)         |
| D04 | **Absence d'ADR pour l'installateur Windows** et le chunking des sections                                                                                                                 | Faible | Faible               | Basse (documentation)          |
| D05 | **Benchmark sur corpus synthétique uniquement** : Recall@10 = 0,617 ne peut être extrapolé à la documentation réelle sans nouveau benchmark                                               | Moyen  | Moyen                | Moyenne                        |
| D06 | **Index de pagination C008** ajouté après les premières migrations : rappelle que l'optimisation des requêtes n'est pas exhaustive                                                        | Faible | Faible               | Basse                          |
