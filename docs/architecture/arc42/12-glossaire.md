# Section 12 — Glossaire

> arc42 · mcp-search-net v1.1.0 · 2026-08-08

---

## Termes métier

| Terme                      | Définition                                                                                                                                                                  |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Catalogue documentaire** | Base de données locale (`catalog.db`) qui stocke des sources, documents, versions et sections ingérés manuellement ou synchronisés depuis des URLs                          |
| **Source officielle**      | Domaine ou URL répertorié dans `official-sources.yml`, auquel le classement des résultats de recherche accorde une priorité plus haute                                      |
| **Section**                | Fragment de contenu d'un document (≤ 12 000 caractères), unité atomique du catalogue V2 ; identifiée par un `sectionId` utilisable dans `read_doc_section`                  |
| **Chunk**                  | Fragment résultant du découpage automatique d'une section source dépassant la limite de 12 000 caractères, avec un chevauchement de 400 caractères entre fragments contigus |
| **Synchronisation**        | Opération CLI déclenchée manuellement (`catalog sync`) qui récupère la version courante d'un document depuis son URL source et met à jour le catalogue                      |
| **Stale fallback**         | Réponse de cache expirée retournée lorsque le fournisseur est indisponible ; signalée par `cacheStatus=STALE_FALLBACK` et le warning `STALE_CACHE_USED`                     |

---

## Termes techniques

| Terme                          | Définition                                                                                                                                           |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| **MCP**                        | Model Context Protocol — protocole JSON-RPC pour exposer des outils et des ressources à un agent LLM                                                 |
| **STDIO**                      | Mode de transport MCP utilisant `stdin`/`stdout` du processus ; aucun port réseau ouvert                                                             |
| **FTS5**                       | Full-Text Search 5 — module SQLite de recherche plein texte avec algorithme de ranking BM25                                                          |
| **BM25**                       | Algorithme de scoring pour la recherche plein texte, variante probabiliste du TF-IDF                                                                 |
| **SSRF**                       | Server-Side Request Forgery — attaque permettant à un attaquant de faire émettre des requêtes vers des ressources internes par un serveur            |
| **Hexagonal architecture**     | Style architecturel (Ports & Adapters) dans lequel le cœur applicatif est protégé des détails d'infrastructure par des interfaces (ports)            |
| **Port**                       | Interface TypeScript dans `src/application/ports/` définissant le contrat d'un service externe sans en connaître l'implémentation                    |
| **Adapter**                    | Implémentation concrète d'un port dans `src/infrastructure/`, branchée par injection de dépendances dans le bootstrap                                |
| **CGNAT**                      | Carrier-Grade NAT — plage `100.64.0.0/10`, bloquée par la politique de sécurité comme réseau non public                                              |
| **DNS rebinding**              | Technique d'attaque consistant à faire résoudre un nom d'hôte public vers une adresse privée après validation ; contré par la re-validation post-DNS |
| **contentless-delete**         | Mode FTS5 où le contenu n'est pas stocké dans l'index mais où les suppressions restent possibles via rowid                                           |
| **N-API**                      | API stable de Node.js pour les modules natifs C/C++ ; garantit la compatibilité entre versions Node sans recompilation                               |
| **ETag**                       | En-tête HTTP de validation de cache permettant de détecter si une ressource a changé (utilisé dans la synchronisation catalogue)                     |
| **requestId**                  | UUID v4 généré par `executeToolCall` pour corréler les événements de logs et télémétrie d'un même appel outil                                        |
| **schemaVersion**              | Champ JSON `"1.0"` présent dans toutes les réponses MCP V2 ; versionnement additionnel du contrat de réponse                                         |
| **EXTERNAL_UNTRUSTED_CONTENT** | Marqueur appliqué à tout contenu web ou documentaire dans les réponses MCP ; indique que le serveur n'a pas exécuté ce contenu                       |

---

## Acronymes

| Acronyme | Développement                                    |
| -------- | ------------------------------------------------ |
| ADR      | Architecture Decision Record                     |
| BM25     | Best Match 25                                    |
| CGNAT    | Carrier-Grade Network Address Translation        |
| CI       | Continuous Integration                           |
| ESM      | ECMAScript Modules                               |
| FTS      | Full-Text Search                                 |
| IDE      | Integrated Development Environment               |
| JSON-RPC | JavaScript Object Notation Remote Procedure Call |
| LLM      | Large Language Model                             |
| MCP      | Model Context Protocol                           |
| MRR      | Mean Reciprocal Rank                             |
| nDCG     | Normalized Discounted Cumulative Gain            |
| PDF      | Portable Document Format                         |
| RRF      | Reciprocal Rank Fusion                           |
| SHA      | Secure Hash Algorithm                            |
| SSRF     | Server-Side Request Forgery                      |
| STDIO    | Standard Input/Output                            |
| TTL      | Time To Live                                     |
| UUID     | Universally Unique Identifier                    |
