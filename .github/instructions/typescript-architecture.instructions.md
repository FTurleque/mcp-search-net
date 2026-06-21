---
name: TypeScript Architecture
description: >
  Contraintes d'architecture TypeScript pour les fichiers source de mcp-search-net :
  hexagonal strict, boundaries de couches, contrats readonly, gestion des erreurs
  stables, et déterminisme du domaine. S'applique à tout fichier src/**/*.ts.
applyTo: 'src/**/*.ts'
owner: mcp-search-net
version: 1.1.0
lastReviewed: '2026-06-21'
---

# Architecture TypeScript — mcp-search-net

## Principes fondamentaux

### TypeScript strict

- Active `strict: true` et `exactOptionalPropertyTypes: true` dans `tsconfig.json`.
- **Omets** les propriétés optionnelles absentes plutôt que d'assigner `undefined`.
- Préfère les **unions stables explicites** (`'hit' | 'miss' | 'bypass'`) aux chaînes libres.
- Préfère les **types readonly** pour les modèles domain et les contrats d'application.

```typescript
// ✅ Correct
type CacheStatus = 'hit' | 'miss' | 'bypass';
interface SearchResult { readonly url: string; readonly title: string; }

// ❌ Incorrect
type CacheStatus = string;
interface SearchResult { url?: string | undefined; title?: string | undefined; }
```

### Boundaries de couches — règle d'import

| Couche | Peut importer | Ne peut jamais importer |
|--------|--------------|------------------------|
| `domain` | Rien d'externe | `infrastructure`, `presentation`, MCP SDK, SQLite, YAML, Zod, SearXNG, Crawl4AI |
| `application` | `domain` | `infrastructure`, MCP SDK, SQLite, HTTP, DNS |
| `infrastructure` | `domain`, `application/ports` | `presentation`, `bootstrap` |
| `presentation/mcp` | `domain`, `application` | `infrastructure` directement (via use cases) |
| `bootstrap` | Tout | (point de composition uniquement) |

**Vérification** : `grep -r "from.*infrastructure" src/domain/` doit retourner vide.

### Ports d'application

Toute dépendance externe (HTTP, DNS, SQLite, SearXNG, Crawl4AI, horloge, filesystem) est déclarée comme **interface dans `application/ports/`** avant d'être implémentée en `infrastructure/`.

```typescript
// ✅ src/application/ports/content-fetcher.ts
export interface ContentFetcher {
  fetch(url: PublicUrl): Promise<FetchResult>;
}

// ✅ src/infrastructure/fetch/crawl4ai-content-fetcher.ts
export class Crawl4AIContentFetcher implements ContentFetcher { ... }

// ❌ src/application/use-cases/fetch-url.ts
import { Crawl4AIContentFetcher } from '../../infrastructure/fetch/crawl4ai-content-fetcher.js';
```

## Handlers MCP — règle de finesse

Les handlers `presentation/mcp/` suivent exactement ce patron :
1. Parser et valider les arguments d'entrée (schéma Zod)
2. Invoquer **un seul** use case
3. Valider et formater la réponse (envelope + fallback texte compact)

```typescript
// ✅ Handler fin
export async function handleSearchWeb(args: unknown): Promise<McpResponse> {
  const input = SearchWebInputSchema.parse(args);           // 1. Parse
  const result = await searchWebUseCase.execute(input);      // 2. Use case
  return formatSearchWebResponse(result);                    // 3. Format
}

// ❌ Logique métier dans le handler
export async function handleSearchWeb(args: unknown): Promise<McpResponse> {
  const input = SearchWebInputSchema.parse(args);
  const cached = await cache.get(input.query);               // ❌ cache direct
  if (!cached) { ... }                                       // ❌ logique use-case
}
```

## Normalisation des données hostiles

Normalise les données non fiables **une seule fois à la frontière d'entrée** (`infrastructure` ou `presentation`), puis propage les valeurs canoniques sûres.

```typescript
// ✅ Normalisation à la frontière infrastructure
const safeTitle = sanitizeText(raw.title ?? '').slice(0, MAX_TITLE_LENGTH);

// ❌ Pas de re-sanitization à chaque couche
const title = raw.title; // passé brut au domain
```

## Gestion des erreurs

- Les **erreurs attendues** se mappent vers des **codes d'erreur publics stables** (`SEARCH_PROVIDER_UNAVAILABLE`, `URL_BLOCKED`, etc.) définis dans `src/domain/errors/`.
- Les **détails inattendus** (messages d'exception, stack traces, corps provider) appartiennent uniquement aux **logs structurés vers stderr**.
- Ne jamais exposer de message d'erreur infrastructure dans une réponse MCP cliente.

```typescript
// ✅ Mapping vers erreur stable
catch (error) {
  logger.error({ err: error }, 'searxng_unavailable');
  throw new DomainError('SEARCH_PROVIDER_UNAVAILABLE');
}

// ❌ Exposition de détails internes
catch (error) {
  throw new Error(`SearXNG error: ${error.message} at ${error.stack}`);
}
```

## Déterminisme du domaine

Le code `src/domain/` ne doit contenir **aucune dépendance cachée** vers :
- L'heure (`Date.now()`, `new Date()`) → injecter via port `Clock`
- Le hasard (`Math.random()`) → injecter ou éviter
- DNS, filesystem, réseau → strictement interdit
- Variables d'environnement → lire uniquement dans `infrastructure/config/`

```typescript
// ✅ Horloge injectée
export function isExpired(entry: CacheEntry, clock: Clock): boolean {
  return clock.now() > entry.expiresAt;
}

// ❌ Date.now() direct dans domain
export function isExpired(entry: CacheEntry): boolean {
  return Date.now() > entry.expiresAt;
}
```
