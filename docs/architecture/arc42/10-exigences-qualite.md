# Section 10 — Exigences qualité

> arc42 · mcp-search-net v1.1.0 · 2026-08-08

Les scénarios détaillés se trouvent aussi dans [`../quality/scenarios.md`](../quality/scenarios.md).

---

## 10.1 Tableau des attributs qualité

| #   | Attribut           | Importance | Description                                                                   |
| --- | ------------------ | ---------- | ----------------------------------------------------------------------------- |
| Q1  | **Sécurité**       | Critique   | Toute URL est traitée comme hostile ; aucun réseau privé ne doit être atteint |
| Q2  | **Fiabilité**      | Critique   | Les pannes fournisseur doivent être récupérables (stale, code stable)         |
| Q3  | **Maintenabilité** | Haute      | Les couches sont indépendantes ; les tests substituent les fournisseurs       |
| Q4  | **Performance**    | Haute      | FTS5 p95 ≤ 150 ms ; téléchargement dans le budget alloué                      |
| Q5  | **Portabilité**    | Haute      | Installation sur Windows sans droits admin + Docker Compose                   |
| Q6  | **Auditabilité**   | Moyenne    | Codes d'erreur stables, logs corrélés par `requestId`                         |

---

## 10.2 Scénarios qualité

### Q1-S1 — URL menant à un réseau privé (Sécurité)

| Champ                       | Valeur                                                                                              |
| --------------------------- | --------------------------------------------------------------------------------------------------- |
| **Stimulus**                | Agent LLM appelle `fetch_url` avec `http://192.168.1.100/admin`                                     |
| **Environnement**           | Runtime nominal, cache vide                                                                         |
| **Réponse attendue**        | Connexion refusée, réponse MCP `isError:true` avec code `BLOCKED_ADDRESS`                           |
| **Mesure**                  | Aucune connexion réseau vers `192.168.1.100`                                                        |
| **Seuil**                   | 100 % des cas testés                                                                                |
| **Méthode de vérification** | `tests/security/protocol-matrix.test.ts`, `tests/infrastructure/public-url-security-policy.test.ts` |
| **Propriétaire**            | Auteur                                                                                              |

---

### Q1-S2 — DNS rebinding (Sécurité)

| Champ                       | Valeur                                                                       |
| --------------------------- | ---------------------------------------------------------------------------- |
| **Stimulus**                | URL avec nom d'hôte public résolvant vers `127.0.0.1` (après résolution DNS) |
| **Environnement**           | Runtime nominal                                                              |
| **Réponse attendue**        | `BlockedAddressError` après validation de toutes les adresses résolues       |
| **Mesure**                  | Aucune connexion vers l'adresse privée                                       |
| **Seuil**                   | 100 % des cas testés                                                         |
| **Méthode de vérification** | `tests/security/protocol-matrix.test.ts`                                     |
| **Propriétaire**            | Auteur                                                                       |

---

### Q1-S3 — Redirect vers IP privée (Sécurité)

| Champ                       | Valeur                                                       |
| --------------------------- | ------------------------------------------------------------ |
| **Stimulus**                | URL publique valide qui redirige vers `http://10.0.0.1/`     |
| **Environnement**           | Runtime nominal                                              |
| **Réponse attendue**        | Re-validation SSRF après redirection → `BlockedAddressError` |
| **Mesure**                  | Connexion interrompue avant la destination privée            |
| **Seuil**                   | 100 % des cas testés                                         |
| **Méthode de vérification** | `tests/infrastructure/secure-http-gateway.test.ts`           |
| **Propriétaire**            | Auteur                                                       |

---

### Q2-S1 — Panne SearXNG avec stale disponible (Fiabilité)

| Champ                       | Valeur                                                                             |
| --------------------------- | ---------------------------------------------------------------------------------- |
| **Stimulus**                | `search_web` appelé alors que SearXNG retourne HTTP 503                            |
| **Environnement**           | Cache contient une entrée stale (expirée mais dans la rétention)                   |
| **Réponse attendue**        | Réponse `status=partial`, `cacheStatus=STALE_FALLBACK`, warning `STALE_CACHE_USED` |
| **Mesure**                  | Réponse servie ; pas d'exception propagée au client MCP                            |
| **Seuil**                   | 100 % des cas testés                                                               |
| **Méthode de vérification** | `tests/application/search-web.test.ts`                                             |
| **Propriétaire**            | Auteur                                                                             |

---

### Q2-S2 — Cache SQLite inouvrable (Fiabilité)

| Champ                       | Valeur                                                                      |
| --------------------------- | --------------------------------------------------------------------------- |
| **Stimulus**                | `cache.sqlite` corrompu ou inaccessible au démarrage                        |
| **Environnement**           | `cache.continueOnError = true`                                              |
| **Réponse attendue**        | Démarrage réussi avec `DisabledCacheRepository` ; log d'erreur sur `stderr` |
| **Mesure**                  | `cacheStatus=DISABLED` dans les réponses ; pas de crash du processus        |
| **Seuil**                   | 100 % des cas testés                                                        |
| **Méthode de vérification** | `tests/presentation/container-configuration.test.ts`                        |
| **Propriétaire**            | Auteur                                                                      |

---

### Q3-S1 — Frontière domaine/infrastructure (Maintenabilité)

| Champ                       | Valeur                                                     |
| --------------------------- | ---------------------------------------------------------- |
| **Stimulus**                | Modification d'un adaptateur infrastructure                |
| **Environnement**           | CI (tout commit vers `master` ou PR)                       |
| **Réponse attendue**        | `grep -r "from.*infrastructure" src/domain/` retourne vide |
| **Mesure**                  | Zéro violation de la règle d'import                        |
| **Seuil**                   | 0 violation                                                |
| **Méthode de vérification** | `npm run check:ci-hygiene`                                 |
| **Propriétaire**            | CI                                                         |

---

### Q4-S1 — Latence FTS5 à 10 000 sections (Performance)

| Champ                       | Valeur                                                            |
| --------------------------- | ----------------------------------------------------------------- |
| **Stimulus**                | `search_docs` sur corpus de 10 000 sections, 50 requêtes annotées |
| **Environnement**           | Benchmark V2.13, Windows, Node.js 24.17.0                         |
| **Réponse attendue**        | p95 ≤ 150 ms                                                      |
| **Mesure**                  | p95 = 17,3 ms (benchmark V2.13, SHA `aeb49b1f…`)                  |
| **Seuil**                   | p95 ≤ 150 ms                                                      |
| **Méthode de vérification** | `npm run benchmark:v2:search-quality`                             |
| **Propriétaire**            | Auteur                                                            |

---

### Q4-S2 — Téléchargement dans le budget (Performance)

| Champ                       | Valeur                                                |
| --------------------------- | ----------------------------------------------------- |
| **Stimulus**                | `fetch_url` sur une page de 15 Mo                     |
| **Environnement**           | Runtime nominal, `maxDownloadBytes = 10 485 760`      |
| **Réponse attendue**        | Interruption à 10 Mo, `ResponseTooLargeError`         |
| **Mesure**                  | Aucun octet supplémentaire téléchargé après la limite |
| **Seuil**                   | 100 % des cas testés                                  |
| **Méthode de vérification** | `tests/performance/gateway-performance.test.ts`       |
| **Propriétaire**            | Auteur                                                |

---

### Q5-S1 — Installation Windows sans droits admin (Portabilité)

| Champ                       | Valeur                                                                |
| --------------------------- | --------------------------------------------------------------------- |
| **Stimulus**                | Exécution de `setup.exe` sur Windows 10 sans droits administrateur    |
| **Environnement**           | Installation dans `%LOCALAPPDATA%`                                    |
| **Réponse attendue**        | Installation complète, MCP client configuré, services Docker démarrés |
| **Mesure**                  | Aucun échec d'élévation UAC                                           |
| **Seuil**                   | Installation réussie                                                  |
| **Méthode de vérification** | Job CI `Windows installation and STDIO packaging`                     |
| **Propriétaire**            | CI                                                                    |

---

### Q6-S1 — Codes d'erreur stables (Auditabilité)

| Champ                       | Valeur                                                             |
| --------------------------- | ------------------------------------------------------------------ |
| **Stimulus**                | Modification d'un handler MCP qui change le code d'erreur retourné |
| **Environnement**           | CI                                                                 |
| **Réponse attendue**        | Tests de contrat échouent et bloquent la PR                        |
| **Mesure**                  | `npm run test:contract` rouge                                      |
| **Seuil**                   | Zéro régression des codes d'erreur publics                         |
| **Méthode de vérification** | `tests/contract/provider-contract.test.ts`                         |
| **Propriétaire**            | CI                                                                 |
