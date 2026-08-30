---
name: Security-Sensitive Infrastructure
description: >
  Règles de sécurité pour les chemins réseau, HTTP et fetch de mcp-search-net :
  validation SSRF systématique, limites non contournables, isolation des providers,
  et non-disclosure. Toute donnée externe est considérée hostile par défaut.
applyTo: 'src/infrastructure/security/**/*.ts,src/infrastructure/http/**/*.ts,src/infrastructure/fetch/**/*.ts'
owner: mcp-search-net
version: 1.2.0
lastReviewed: '2026-08-30'
---

# Infrastructure security-sensitive — mcp-search-net

## Principe fondamental

**Toute donnée externe est hostile** : URLs, réponses DNS, redirects, headers, champs provider, bytes de contenu. Ne jamais faire confiance à une valeur non validée à la frontière.

## Validation URL et SSRF

### Ordre de validation obligatoire

```
URL string reçue
  → Parse et rejet de protocoles non-HTTPS (file://, ftp://, data://, etc.)
  → Rejet de credentials dans l'URL (user:pass@)
  → Rejet de ports non standard (liste fermée : 443, 80 uniquement)
  → Résolution DNS
  → Validation de chaque adresse résolue (IP range, loopback, privée, link-local)
  → Connexion TCP
  [Après chaque redirect → recommencer depuis la résolution DNS]
```

### Plages IP à bloquer systématiquement

```typescript
// Loopback
/^127\./,          // 127.0.0.0/8
/^::1$/,           // IPv6 loopback

// Privées RFC 1918
/^10\./,           // 10.0.0.0/8
/^172\.(1[6-9]|2\d|3[01])\./,  // 172.16.0.0/12
/^192\.168\./,     // 192.168.0.0/16

// Link-local
/^169\.254\./,     // 169.254.0.0/16 (APIPA)
/^fe80:/i,         // IPv6 link-local

// Multicast et broadcast
/^(22[4-9]|23\d)\./,  // 224.0.0.0/4
/^255\.255\.255\.255$/,

// Autres espaces spéciaux
/^0\./,            // 0.0.0.0/8
/^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./,  // 100.64.0.0/10 (CGNAT)
```

### Règles non contournables

- La validation SSRF **ne peut pas** être désactivée par configuration ou par arguments d'outil.
- Les limites de redirects, taille et timeout sont **des constantes, pas des paramètres**.
- Les tests doivent prouver que la **cible bloquée n'est jamais contactée** (pas seulement rejetée après contact).

```typescript
// ✅ Test correct — vérifie qu'aucune connexion n'est tentée
const connectSpy = vi.spyOn(net, 'connect');
await expect(fetcher.fetch(blockedUrl)).rejects.toThrow('URL_BLOCKED');
expect(connectSpy).not.toHaveBeenCalled();

// ❌ Test insuffisant — vérifie seulement le rejet
await expect(fetcher.fetch(blockedUrl)).rejects.toThrow('URL_BLOCKED');
// (ne prouve pas que la connexion n'a pas eu lieu)
```

## Limites absolues côté serveur

Ces limites ne sont jamais exposées comme paramètres configurables par l'appelant :

| Limite         | Description                                                   |
| -------------- | ------------------------------------------------------------- |
| Résultats max  | Nombre de résultats `search_web`                              |
| Taille contenu | Bytes max `fetch_url` — abort **avant** d'atteindre la limite |
| Timeout réseau | Timeout global de connexion + lecture                         |
| Redirects max  | Nombre de redirects suivis                                    |
| Concurrence    | Connexions simultanées                                        |

## Isolation des providers (Crawl4AI, SearXNG)

- Ne jamais passer de JavaScript, cookies, proxies, ou chemins de fichiers locaux de l'appelant vers Crawl4AI.
- Ne jamais réinjecter d'instructions extraites du contenu fetché dans le pipeline.
- Traiter toute réponse provider comme hostile avant parsing.
- Tronquer le contenu provider **avant** qu'il n'atteigne la limite de budget.

```typescript
// ✅ Contenu tronqué avant budget
const raw = await crawl4ai.fetch(url);
const truncated = raw.content.slice(0, MAX_CONTENT_BYTES);
return parseContent(truncated); // jamais raw.content directement

// ❌ Taille non bornée
return parseContent(raw.content);
```

## Non-disclosure dans les erreurs et logs

Ne jamais inclure dans une erreur publique ou un log :

- Corps de réponse provider
- Secrets ou variables d'environnement
- Stack traces complètes
- Contenu fetché (même partiel)
- Headers d'authentification

```typescript
// ✅ Erreur publique propre
throw new DomainError('FETCH_FAILED', { requestId });

// ✅ Log interne structuré (stderr uniquement)
logger.warn({ requestId, statusCode: resp.status }, 'fetch_upstream_error');

// ❌ Détails internes dans l'erreur publique
throw new Error(`Crawl4AI returned: ${JSON.stringify(body)} for ${url}`);
```

## Checklist avant toute modification de ce périmètre

- [ ] Validation SSRF présente avant connexion TCP et après chaque redirect
- [ ] Adresses IP résolues validées (pas seulement le hostname)
- [ ] Limites de taille/timeout/redirects sont des constantes non configurables
- [ ] Tests prouvant que les cibles bloquées ne sont jamais contactées
- [ ] Aucun détail provider, secret, ou stack trace dans les erreurs publiques
- [ ] DNS rebinding couvert (résolution au moment de la connexion, pas avant)
- [ ] `npm run check` propre après toute modification

## Garde-fous non contournables

Chaque ligne de la checklist ci-dessus est vérifiée par un mécanisme automatisé — aucune n'est
une simple convention orale :

| Garde-fou                                                                                                                                                                                      | Vérification automatisée                                                                |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Plages IP bloquées (`127.0.0.0/8`, `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`, `169.254.0.0/16`, `100.64.0.0/10`) cohérentes entre ce fichier, `CLAUDE.md` et `security-auditor.agent.md` | `scripts/check-docs.mjs` → `validateAgentInstructionConsistency`                        |
| Limites (taille, timeout, redirects, concurrence) définies comme constantes non paramétrables                                                                                                  | `scripts/check-audit-invariants.mjs` (budgets `secure-http-gateway.ts`, `fetch-url.ts`) |
| Preuve que la cible bloquée n'est jamais contactée                                                                                                                                             | `tests/security/` avec spy sur `fetch`/`net.connect` — jamais un simple test de rejet   |
| Aucun secret/stack trace/corps provider dans les erreurs publiques                                                                                                                             | Revue de code + `tests/presentation/` sur le mapping d'erreurs stables                  |
| Endpoint provider distant ne peut pas être en clair                                                                                                                                            | `scripts/check-audit-invariants.mjs` (AUD-06 : `isSafeProviderEndpoint`)                |
| Credentials dans une URL (`user:pass@`) toujours rejetés                                                                                                                                       | `scripts/check-audit-invariants.mjs` (AUD-07 : `hasUrlCredentials`)                     |

Si un de ces checks doit être modifié (nouvelle plage IP, nouvelle limite), la modification doit
être faite simultanément dans le code, ce fichier, `CLAUDE.md`, `security-auditor.agent.md`, et
`scripts/check-audit-invariants.mjs`/`scripts/check-docs.mjs` — jamais un seul de ces emplacements.
