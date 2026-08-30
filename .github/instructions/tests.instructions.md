---
name: Tests
description: >
  Règles de test pour mcp-search-net : déterminisme offline, contrats comportementaux,
  injection de dépendances, couverture hostile/boundary, et séparation stdout/stderr.
  S'applique à tous les fichiers tests/**/*.ts.
applyTo: 'tests/**/*.ts'
owner: mcp-search-net
version: 1.2.0
lastReviewed: '2026-08-30'
---

# Tests — mcp-search-net

## Principes fondamentaux

### Tester les comportements, pas les détails d'implémentation

```typescript
// ✅ Test de comportement et contrat
it('retourne URL_BLOCKED pour une adresse loopback', async () => {
  const result = await useCase.execute({ url: 'http://127.0.0.1/secret' });
  expect(result.error.code).toBe('URL_BLOCKED');
});

// ❌ Test de détail d'implémentation
it('appelle isPrivateAddress avec la bonne regex', () => {
  expect(securityPolicy._privateRangeRegex.test('127.0.0.1')).toBe(true);
});
```

### Déterminisme et isolation offline

Les tests ordinaires (hors E2E) doivent passer :

- **Sans accès réseau**
- **Sans container Docker** (SearXNG, Crawl4AI, SQLite en mode in-memory)
- **Sans variable d'environnement spéciale**
- **Dans n'importe quel ordre** et en parallèle

Les tests live sont explicitement gatedés :

```typescript
// ✅ Gate E2E correct
const RUN_LIVE = process.env.RUN_LIVE_SEARXNG === '1';
it.skipIf(!RUN_LIVE)('search_web avec SearXNG réel', async () => { ... });
```

## Structure des tests par couche

### Domain (`tests/domain/`)

- Données de test inline ou fixtures JSON sans imports infra
- Aucun mock, spy, ou stub nécessaire (code déterministe pur)
- Couvrir les valeurs limites des modèles et règles métier

### Application (`tests/application/`)

- Injecter des doubles de test pour chaque port (search provider, cache, fetcher, clock, resolver)
- Tester les use cases en isolation totale des fournisseurs réels
- Vérifier la propagation des erreurs stables depuis les ports

```typescript
// ✅ Injection de doubles
const fakeProvider: SearchProvider = {
  search: vi.fn().mockResolvedValue({ results: [], warnings: [] }),
};
const useCase = new SearchWebUseCase(fakeProvider, fakeCache, fakeClock);
```

### Infrastructure (`tests/infrastructure/`)

- Utiliser des serveurs HTTP de test (`vi.mock`, `msw`, ou serveur Express local) pour les providers
- Injecter des résolveurs DNS de test pour les contrôles SSRF
- SQLite : utiliser `:memory:` pour l'isolation entre tests
- Couvrir : nominal, timeout, réponse malformée, limite de taille, redirect bloqué

### Présentation (`tests/presentation/`)

- Tester le mapping schéma Zod → use case → réponse MCP
- Vérifier que les handlers sont fins (aucune logique métier)
- Vérifier tous les codes d'erreur publics stables

## Couverture obligatoire — chemins security-sensitive

Pour toute modification de `src/infrastructure/security/`, `http/`, ou `fetch/`, ajouter des tests couvrant :

| Catégorie       | Cas à couvrir                                                                             |
| --------------- | ----------------------------------------------------------------------------------------- |
| URLs bloquées   | Loopback, privé, link-local, protocole non-HTTPS, credentials dans URL, port non standard |
| Redirects       | Redirect vers IP privée, chaîne de redirects > max, redirect vers autre protocole         |
| DNS rebinding   | Hostname résolu vers IP privée après validation initiale                                  |
| Taille          | Réponse > MAX_BYTES abortée avant réception complète                                      |
| Timeout         | Connexion et lecture bornées indépendamment                                               |
| Contenu hostile | Instructions de page non réinjectées, Markdown sanitisé                                   |

**Règle** : chaque test SSRF doit prouver que la cible bloquée n'est **jamais contactée** :

```typescript
// ✅ Preuve de non-contact
const fetchSpy = vi.spyOn(globalThis, 'fetch');
await expect(useCase.execute({ url: 'http://169.254.169.254/meta-data' })).rejects.toMatchObject({
  code: 'URL_BLOCKED',
});
expect(fetchSpy).not.toHaveBeenCalled();
```

## Vérification des contrats publics

Vérifier systématiquement dans les tests d'intégration :

- `requestId` : présent et non vide dans toute réponse
- `sourceUrl` : URL originale préservée (pas normalisée de façon destructive)
- `cacheStatus` : `'hit'` ou `'miss'` ou `'bypass'` — jamais `undefined`
- `warnings` : tableau vide ou avec messages stables (pas de détails internes)
- stdout : aucune écriture informative (tester en capturant `process.stdout`)

```typescript
// ✅ Vérification de séparation stdout/stderr
const stdoutChunks: Buffer[] = [];
const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
  stdoutChunks.push(Buffer.from(chunk));
  return true;
});

await handler.handle(request);

for (const chunk of stdoutChunks) {
  expect(() => JSON.parse(chunk.toString())).not.toThrow(); // doit être du JSON-RPC valide
}
```

## Validation proportionnelle

| Portée du changement   | Commande                        |
| ---------------------- | ------------------------------- |
| Un fichier test        | `npx vitest run tests/<path>`   |
| Une couche             | `npx vitest run tests/<layer>/` |
| Changement cross-layer | `npm run check` sous Node 24    |

## Garde-fous non contournables

| Règle                                                     | Vérification automatisée                                                                         |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Tests ordinaires déterministes, offline, sans Docker      | CI (`npm run check`) exécute sans réseau ni service ; jamais de skip silencieux                  |
| Tests live gatedés par variable d'environnement explicite | `it.skipIf(!RUN_LIVE_...)` — grep du code, jamais de gate implicite                              |
| Preuve de non-contact pour toute cible SSRF bloquée       | `tests/security/` avec spy sur `fetch`/`net.connect` — voir `security-sensitive.instructions.md` |
| Séparation stdout (JSON-RPC)/stderr (diagnostics)         | `tests/presentation/` capture `process.stdout.write` et parse en JSON-RPC                        |
| Régression d'un audit passé ne doit jamais réapparaître   | `node scripts/check-audit-invariants.mjs` (invariants AUD-01..AUD-07)                            |

Ne jamais marquer un test comme « temporairement ignoré » sans justification documentée dans le
code et sans qu'un ticket/roadmap explicite le couvre.
